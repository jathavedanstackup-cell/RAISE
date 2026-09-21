import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** See docs/decisions.md's CP7 entry for the full design and why this is a ticket, not the staff JWT. */
export const TICKET_TTL_MS = 20_000;

export interface TicketClaim {
  staffUserId: string;
  restaurantId: string;
}

interface StoredClaim extends TicketClaim {
  expiresAt: number;
}

/**
 * In-memory, single-process, single-use ticket store. Deliberately not
 * Redis or a DB table — tickets live ~20s and this codebase has no other
 * reason to run a shared cache yet. This stops being correct the moment
 * apps/api runs as more than one instance (a ticket minted on instance A
 * wouldn't be recognized by instance B); flagged explicitly in
 * docs/decisions.md as the thing to revisit before horizontal scaling.
 */
@Injectable()
export class RealtimeTicketService {
  private readonly tickets = new Map<string, StoredClaim>();

  mint(staffUserId: string, restaurantId: string): { ticket: string; expiresInMs: number } {
    this.sweepExpired();
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { staffUserId, restaurantId, expiresAt: Date.now() + TICKET_TTL_MS });
    return { ticket, expiresInMs: TICKET_TTL_MS };
  }

  /** Single-use: consuming a ticket removes it immediately, whether or not it turns out to be valid — replay protection either way. */
  consume(ticket: string): TicketClaim | null {
    const claim = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!claim) return null;
    if (claim.expiresAt < Date.now()) return null;
    return { staffUserId: claim.staffUserId, restaurantId: claim.restaurantId };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [ticket, claim] of this.tickets) {
      if (claim.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
