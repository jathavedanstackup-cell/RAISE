import type { IncomingMessage } from 'node:http';
import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebSocket } from 'ws';
import { requireEnv } from '../auth/env.util.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { VISIT_CONFIRMED, VISIT_TABLE_REASSIGNED, VisitConfirmedEvent, VisitTableReassignedEvent } from './realtime.events.js';
import { VISIT_KITCHEN_ACCEPTED, VISIT_TIMING_RECOMPUTED, VisitKitchenAcceptedEvent, VisitTimingRecomputedEvent } from '../timing/timing.events.js';

/** Caps how many sockets one restaurant can hold open at once (WS-08 in the CP7 threat model) — a runaway/buggy client shouldn't be able to degrade the shared process for every other connected restaurant. */
const MAX_CONNECTIONS_PER_RESTAURANT = 50;

const CLOSE_ORIGIN_NOT_ALLOWED = 4403;
const CLOSE_MISSING_OR_INVALID_TICKET = 4401;
const CLOSE_TOO_MANY_CONNECTIONS = 4429;

/**
 * CP7 — the WebSocket surface for the FOH dashboard (and CP8's kitchen
 * display, which reuses this same gateway/auth pattern). See
 * docs/decisions.md's CP7 entry for the full design and the two
 * non-negotiable findings this class exists to satisfy:
 *
 *   - Room membership is computed HERE, from the verified ticket's own
 *     claim, never from anything the client sends. There is no
 *     "subscribe to restaurant X" message this Gateway ever listens for.
 *   - Every emit targets a specific restaurant's connection set
 *     explicitly (`emitToRestaurant`) — there is no bare broadcast-to-all
 *     anywhere in this file, and there must never be one added later.
 *
 * Uses @nestjs/platform-ws (native `ws`), not Socket.IO — see main.ts's
 * `useWebSocketAdapter(new WsAdapter(app))`. That's what gives
 * `handleConnection` direct access to the raw upgrade `IncomingMessage`,
 * which is what a ticket carried in `Sec-WebSocket-Protocol` needs.
 */
@Injectable()
@WebSocketGateway()
export class VisitsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VisitsGateway.name);
  private readonly connectionsByRestaurant = new Map<string, Set<WebSocket>>();
  private readonly restaurantBySocket = new Map<WebSocket, string>();

  constructor(private readonly tickets: RealtimeTicketService) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    if (!this.isAllowedOrigin(request.headers.origin)) {
      client.close(CLOSE_ORIGIN_NOT_ALLOWED, 'origin not allowed');
      return;
    }

    const ticketValue = this.extractTicket(request.headers['sec-websocket-protocol']);
    const claim = ticketValue ? this.tickets.consume(ticketValue) : null;
    if (!claim) {
      client.close(CLOSE_MISSING_OR_INVALID_TICKET, 'missing or invalid ticket');
      return;
    }

    const existing = this.connectionsByRestaurant.get(claim.restaurantId) ?? new Set<WebSocket>();
    if (existing.size >= MAX_CONNECTIONS_PER_RESTAURANT) {
      client.close(CLOSE_TOO_MANY_CONNECTIONS, 'too many connections for this restaurant');
      return;
    }

    existing.add(client);
    this.connectionsByRestaurant.set(claim.restaurantId, existing);
    this.restaurantBySocket.set(client, claim.restaurantId);
  }

  handleDisconnect(client: WebSocket): void {
    const restaurantId = this.restaurantBySocket.get(client);
    if (!restaurantId) return;
    this.restaurantBySocket.delete(client);
    this.connectionsByRestaurant.get(restaurantId)?.delete(client);
  }

  @OnEvent(VISIT_CONFIRMED)
  onVisitConfirmed(event: VisitConfirmedEvent): void {
    this.emitToRestaurant(event.restaurantId, 'visit.confirmed', { visitId: event.visitId });
  }

  @OnEvent(VISIT_TABLE_REASSIGNED)
  onTableReassigned(event: VisitTableReassignedEvent): void {
    this.emitToRestaurant(event.restaurantId, 'visit.table_reassigned', {
      visitId: event.visitId,
      previousTableId: event.previousTableId,
      newTableId: event.newTableId,
    });
  }

  @OnEvent(VISIT_TIMING_RECOMPUTED)
  onTimingRecomputed(event: VisitTimingRecomputedEvent): void {
    this.emitToRestaurant(event.restaurantId, 'visit.timing.recomputed', {
      visitId: event.visitId,
      kitchenStartTarget: event.kitchenStartTarget.toISOString(),
      foodOutTarget: event.foodOutTarget.toISOString(),
    });
  }

  @OnEvent(VISIT_KITCHEN_ACCEPTED)
  onKitchenAccepted(event: VisitKitchenAcceptedEvent): void {
    this.emitToRestaurant(event.restaurantId, 'visit.kitchen.accepted', {
      visitId: event.visitId,
      acceptedAt: event.acceptedAt.toISOString(),
    });
  }

  /** The only place this class ever sends to a socket — always scoped to one restaurant's own connection set. */
  private emitToRestaurant(restaurantId: string, event: string, data: Record<string, unknown>): void {
    const sockets = this.connectionsByRestaurant.get(restaurantId);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify({ event, data });
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
      return origin === requireEnv('RESTAURANT_APP_ORIGIN');
    } catch (err) {
      this.logger.error('RESTAURANT_APP_ORIGIN is not configured -- refusing all WebSocket connections', err as Error);
      return false;
    }
  }

  private extractTicket(header: string | string[] | undefined): string | null {
    if (!header) return null;
    // ws parses Sec-WebSocket-Protocol as a comma-separated list already split into an array by the underlying http parser in some cases, a raw comma-joined string in others -- normalize both.
    const values = Array.isArray(header) ? header : header.split(',');
    const first = values[0]?.trim();
    return first && first.length > 0 ? first : null;
  }
}
