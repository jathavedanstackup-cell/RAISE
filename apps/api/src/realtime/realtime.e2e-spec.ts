import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { PasswordService } from '../auth/password.service.js';
import { VISIT_CONFIRMED, VisitConfirmedEvent } from './realtime.events.js';

const ALLOWED_ORIGIN = 'http://localhost:3001';

/**
 * CP7's realtime auth surface: the ticket-exchange design in
 * docs/decisions.md, and the two non-negotiable findings from the CP7
 * threat model (server-computed room scoping, explicit per-restaurant
 * fan-out -- never a bare broadcast). This suite connects real `ws`
 * clients against a real bootstrapped app, not a mocked gateway.
 */
describe('CP7 realtime WebSocket auth', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let passwords: PasswordService;
  let events: EventEmitter2;
  let wsUrl: string;

  const restaurantId = `test-realtime-${randomUUID()}`;
  const restaurantBId = `test-realtime-b-${randomUUID()}`;
  let staffToken: string;
  let staffBToken: string;

  const openSockets: WebSocket[] = [];

  beforeAll(async () => {
    process.env.RESTAURANT_APP_ORIGIN = ALLOWED_ORIGIN;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    const server = await app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    wsUrl = `ws://127.0.0.1:${port}`;

    passwords = app.get(PasswordService);
    events = app.get(EventEmitter2);

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();

    for (const [id, name] of [
      [restaurantId, 'Test Realtime Kitchen'],
      [restaurantBId, 'Test Realtime Kitchen B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550166', settings: {} },
      });
    }

    const passwordHash = await passwords.hash('correct-horse-battery-staple');
    const staffUser = await rawPrisma.user.create({
      data: { email: `realtime-${randomUUID()}@example.test`, passwordHash, name: 'Realtime Staff' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: staffUser.id, restaurantId, role: 'owner' } });
    const login = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffUser.email, password: 'correct-horse-battery-staple' });
    staffToken = login.body.token;

    const staffBUser = await rawPrisma.user.create({
      data: { email: `realtime-b-${randomUUID()}@example.test`, passwordHash, name: 'Realtime Staff B' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: staffBUser.id, restaurantId: restaurantBId, role: 'owner' } });
    const loginB = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffBUser.email, password: 'correct-horse-battery-staple' });
    staffBToken = loginB.body.token;
  });

  afterEach(() => {
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    }
  });

  afterAll(async () => {
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await deleteRestaurantCascade(rawPrisma, restaurantBId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  async function mintTicket(token: string, scopedRestaurantId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${scopedRestaurantId}/realtime/ticket`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(201);
    return res.body.ticket as string;
  }

  /**
   * The `ws` handshake completes (and 'open' fires) BEFORE VisitsGateway's
   * `handleConnection` runs at all -- rejection is "accept, then
   * immediately close with a specific code," not a pre-handshake refusal.
   * So 'open' firing first is expected even for a connection about to be
   * rejected; this waits a short grace window after 'open' to see whether
   * a 'close' follows, rather than racing the two events naively.
   */
  function connect(ticket: string | undefined, origin = ALLOWED_ORIGIN): Promise<{ socket: WebSocket; closeCode?: number }> {
    return new Promise((resolve, reject) => {
      const socket = ticket
        ? new WebSocket(wsUrl, [ticket], { origin })
        : new WebSocket(wsUrl, undefined, { origin });
      openSockets.push(socket);
      let closeCode: number | undefined;
      let opened = false;
      const timeout = setTimeout(() => reject(new Error('connect() timed out')), 5000);
      socket.on('close', (code) => {
        closeCode = code;
        if (!opened) {
          // Rejected before the handshake ever completed -- resolve immediately, no grace window needed.
          clearTimeout(timeout);
          resolve({ socket, closeCode });
        }
      });
      socket.on('error', () => {
        /* the close handler above still fires and this promise still settles via 'open' or the timeout */
      });
      socket.once('open', () => {
        opened = true;
        setTimeout(() => {
          clearTimeout(timeout);
          resolve({ socket, closeCode });
        }, 150);
      });
    });
  }

  function nextMessage(socket: WebSocket): Promise<{ event: string; data: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('nextMessage() timed out')), 3000);
      socket.once('message', (raw) => {
        clearTimeout(timeout);
        resolve(JSON.parse(raw.toString()));
      });
    });
  }

  it('accepts a connection carrying a valid ticket via Sec-WebSocket-Protocol', async () => {
    const ticket = await mintTicket(staffToken, restaurantId);
    const { socket, closeCode } = await connect(ticket);
    expect(closeCode).toBeUndefined();
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('rejects a connection with no ticket at all', async () => {
    const { closeCode } = await connect(undefined);
    expect(closeCode).toBe(4401);
  });

  it('rejects a connection whose ticket was already consumed (single-use, replay protection)', async () => {
    const ticket = await mintTicket(staffToken, restaurantId);
    const first = await connect(ticket);
    expect(first.closeCode).toBeUndefined();

    const second = await connect(ticket);
    expect(second.closeCode).toBe(4401);
  });

  it('rejects a connection from an origin other than RESTAURANT_APP_ORIGIN', async () => {
    const ticket = await mintTicket(staffToken, restaurantId);
    const { closeCode } = await connect(ticket, 'http://evil.example.com');
    expect(closeCode).toBe(4403);
  });

  describe('tenant isolation on the fan-out (WS-02 / WS-03 from the CP7 threat model)', () => {
    it("restaurant B's connected socket never receives an event emitted for restaurant A", async () => {
      const ticketA = await mintTicket(staffToken, restaurantId);
      const ticketB = await mintTicket(staffBToken, restaurantBId);
      const { socket: socketA } = await connect(ticketA);
      const { socket: socketB } = await connect(ticketB);

      const messageOnA = nextMessage(socketA);
      let socketBReceivedSomething = false;
      socketB.once('message', () => {
        socketBReceivedSomething = true;
      });

      const visitId = randomUUID();
      events.emit(VISIT_CONFIRMED, new VisitConfirmedEvent(restaurantId, visitId));

      const received = await messageOnA;
      expect(received).toEqual({ event: 'visit.confirmed', data: { visitId } });

      // Give socket B a moment it doesn't need if isolation holds -- long enough to catch a real broadcast bug, short enough not to slow the suite down.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(socketBReceivedSomething).toBe(false);
    });
  });
});
