import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { VISIT_CONFIRMED, VisitConfirmedEvent } from '../realtime/realtime.events.js';
import { VISIT_TIMING_RECOMPUTED, VisitTimingRecomputedEvent } from '../timing/timing.events.js';
import { NotificationService } from './notification.service.js';
import { SMS_PROVIDER, type SmsProvider, type SmsSendResult } from './sms/sms-provider.interface.js';

/**
 * CP9's "done when": each event type fires EXACTLY once, on retry and on
 * reconnect. That is the whole point of this suite, so it is tested the
 * only way that actually proves it -- by counting real sends through a
 * recording provider, not by asserting on a mock's call count in
 * isolation, and by racing concurrent attempts rather than only
 * repeating them sequentially. A sequential retry passes even against a
 * naive check-then-send; only the concurrent case distinguishes a real
 * database claim from a read-then-write.
 */
class RecordingSmsProvider implements SmsProvider {
  readonly sent: Array<{ to: string; body: string }> = [];

  async send(to: string, body: string): Promise<SmsSendResult> {
    this.sent.push({ to, body });
    return { providerMessageId: `rec-${randomUUID()}` };
  }
}

describe('CP9 notifications', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let events: EventEmitter2;
  let notifications: NotificationService;
  let tenantPrisma: TenantPrismaService;
  let sms: RecordingSmsProvider;

  const restaurantId = `test-notif-${randomUUID()}`;
  const restaurantBId = `test-notif-b-${randomUUID()}`;

  beforeAll(async () => {
    sms = new RecordingSmsProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    // AppModule pulls in CP7's VisitsGateway; without the native-ws adapter
    // Nest tries to load Socket.IO and process.exit(1)s during init.
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();

    events = app.get(EventEmitter2);
    notifications = app.get(NotificationService);
    tenantPrisma = app.get(TenantPrismaService);

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();

    for (const [id, name] of [
      [restaurantId, 'Test Notif'],
      [restaurantBId, 'Test Notif B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550199', settings: {} },
      });
    }
  });

  afterAll(async () => {
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await deleteRestaurantCascade(rawPrisma, restaurantBId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    sms.sent.length = 0;
  });

  let counter = 9000;

  async function seedConfirmedVisit(owner = restaurantId) {
    const suffix = (counter += 1);
    const table = await rawPrisma.table.create({
      data: { restaurantId: owner, label: `N${suffix}`, seatsMin: 1, seatsMax: 4, features: [], status: 'held' },
    });
    const phone = `+1555${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const customer = await rawPrisma.customer.create({ data: { phone, phoneVerifiedAt: new Date() } });
    const visit = await rawPrisma.visit.create({
      data: {
        restaurantId: owner,
        customerId: customer.id,
        tableId: table.id,
        partySize: 2,
        arrivalEta: new Date(Date.now() + 30 * 60_000),
        status: 'confirmed',
      },
    });
    return { visit, table, phone };
  }

  const logsFor = (visitId: string) =>
    rawPrisma.notificationLog.findMany({ where: { visitId }, orderBy: { type: 'asc' } });

  describe('booking confirmation — exactly once', () => {
    it('sends one SMS and writes one claim row for a single confirmation', async () => {
      const { visit, phone } = await seedConfirmedVisit();

      await notifications.sendBookingConfirmation(restaurantId, visit.id);

      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0]!.to).toBe(phone);

      const logs = await logsFor(visit.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.type).toBe('booking_confirmation');
      expect(logs[0]!.status).toBe('sent');
      expect(logs[0]!.sentAt).not.toBeNull();
    });

    it('does not send a second SMS when the same confirmation is retried', async () => {
      const { visit } = await seedConfirmedVisit();

      await notifications.sendBookingConfirmation(restaurantId, visit.id);
      await notifications.sendBookingConfirmation(restaurantId, visit.id);
      await notifications.sendBookingConfirmation(restaurantId, visit.id);

      expect(sms.sent).toHaveLength(1);
      expect(await logsFor(visit.id)).toHaveLength(1);
    });

    it('sends exactly one SMS when five attempts race concurrently', async () => {
      // Opportunistic, and labelled as such: five callers fired at once.
      // Proven to FAIL against a check-then-send implementation -- but
      // only when the window between the read and the write is wide
      // enough to interleave. With the read and write adjacent, this
      // suite passed against a deliberately broken check-then-send, and
      // only failed once a 200ms delay was injected between them. So
      // this test is a useful smoke signal and NOT the proof; the two
      // tests below are. Recorded honestly rather than left to look
      // stronger than it is.
      const { visit } = await seedConfirmedVisit();

      await Promise.all(
        Array.from({ length: 5 }, () => notifications.sendBookingConfirmation(restaurantId, visit.id)),
      );

      expect(sms.sent).toHaveLength(1);
      expect(await logsFor(visit.id)).toHaveLength(1);
    });

    it('sends nothing when another process has already claimed this notification', async () => {
      // Deterministic, no timing involved: the claim row is inserted by
      // someone else first -- a second API instance, a redelivered event,
      // a process that died after claiming. The send must not happen.
      // This is what "exactly once across instances" actually means; a
      // single-process retry test cannot distinguish it.
      const { visit } = await seedConfirmedVisit();
      await rawPrisma.notificationLog.create({
        data: {
          restaurantId,
          visitId: visit.id,
          type: 'booking_confirmation',
          channel: 'sms',
          payload: { claimedBy: 'another-instance' },
        },
      });

      await notifications.sendBookingConfirmation(restaurantId, visit.id);

      expect(sms.sent).toHaveLength(0);
      const logs = await logsFor(visit.id);
      expect(logs).toHaveLength(1);
      // The foreign claim is left exactly as it was -- not overwritten,
      // not marked sent by us.
      expect(logs[0]!.status).toBe('pending');
      expect(logs[0]!.payload).toEqual({ claimedBy: 'another-instance' });
    });

    it('is backed by a real unique constraint on (visit_id, type)', async () => {
      // The actual guarantee, asserted against the live database rather
      // than inferred from application code. Application code can be
      // rewritten into a check-then-send by any future author; this index
      // is what makes that rewrite fail loudly instead of quietly sending
      // a guest a second text. If this test ever fails, the idempotency
      // of every notification in the system is gone -- see
      // docs/decisions.md's CP9 entry.
      const indexes = await rawPrisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notification_logs'
      `;
      const unique = indexes.filter(
        (i) => /UNIQUE/i.test(i.indexdef) && /visit_id/.test(i.indexdef) && /\btype\b/.test(i.indexdef),
      );
      expect(unique).toHaveLength(1);
    });
  });

  describe('new inbound alert — exactly once, and separate from the SMS', () => {
    it('claims under its own type, so a repeated confirm alerts once', async () => {
      const { visit } = await seedConfirmedVisit();
      const seen: string[] = [];
      const listener = (event: { visitId: string }) => {
        if (event.visitId === visit.id) seen.push(event.visitId);
      };
      events.on('notification.new_inbound_alert', listener);

      try {
        await notifications.sendNewInboundAlert(restaurantId, visit.id);
        await notifications.sendNewInboundAlert(restaurantId, visit.id);
      } finally {
        events.off('notification.new_inbound_alert', listener);
      }

      expect(seen).toHaveLength(1);
      const logs = await logsFor(visit.id);
      expect(logs.map((l) => l.type)).toEqual(['new_inbound_alert']);
    });
  });

  describe('subscriber wiring', () => {
    it('one VISIT_CONFIRMED produces both notifications; a redelivery produces neither again', async () => {
      const { visit } = await seedConfirmedVisit();

      // emitAsync awaits the @OnEvent handlers, so this exercises the real
      // subscriber rather than sleeping and hoping.
      await events.emitAsync(VISIT_CONFIRMED, new VisitConfirmedEvent(restaurantId, visit.id));
      await events.emitAsync(VISIT_CONFIRMED, new VisitConfirmedEvent(restaurantId, visit.id));

      expect(sms.sent).toHaveLength(1);
      const logs = await logsFor(visit.id);
      expect(logs.map((l) => l.type)).toEqual(['booking_confirmation', 'new_inbound_alert']);
    });
  });

  describe('ETA drift alert', () => {
    const recompute = (visitId: string, previousMinutes: number | null, newMinutes: number, reason: 'eta_changed' | 'items_changed' = 'eta_changed') =>
      events.emitAsync(
        VISIT_TIMING_RECOMPUTED,
        new VisitTimingRecomputedEvent(
          restaurantId,
          visitId,
          new Date(Date.now() + newMinutes * 60_000),
          new Date(Date.now() + (newMinutes + 20) * 60_000),
          previousMinutes === null ? null : new Date(Date.now() + previousMinutes * 60_000),
          reason,
        ),
      );

    it('alerts when the kitchen start target moves past the threshold', async () => {
      const { visit } = await seedConfirmedVisit();
      await recompute(visit.id, 30, 55); // 25 minutes later

      const logs = await logsFor(visit.id);
      expect(logs.map((l) => l.type)).toEqual(['eta_drift_alert']);
      expect((logs[0]!.payload as { driftMinutes: number }).driftMinutes).toBe(25);
    });

    it('alerts on drift in either direction — a guest arriving much earlier is just as disruptive', async () => {
      const { visit } = await seedConfirmedVisit();
      await recompute(visit.id, 60, 20); // 40 minutes earlier

      const logs = await logsFor(visit.id);
      expect(logs).toHaveLength(1);
      expect((logs[0]!.payload as { driftMinutes: number }).driftMinutes).toBe(-40);
    });

    it('stays silent for a drift under the threshold', async () => {
      const { visit } = await seedConfirmedVisit();
      await recompute(visit.id, 30, 34); // 4 minutes

      expect(await logsFor(visit.id)).toHaveLength(0);
    });

    it('stays silent for an items_changed recompute — staff already know, they made the change', async () => {
      const { visit } = await seedConfirmedVisit();
      await recompute(visit.id, 30, 60, 'items_changed');

      expect(await logsFor(visit.id)).toHaveLength(0);
    });

    it('stays silent for the first computation, which has no previous target to drift from', async () => {
      const { visit } = await seedConfirmedVisit();
      await recompute(visit.id, null, 30);

      expect(await logsFor(visit.id)).toHaveLength(0);
    });

    it('does not re-alert on a second significant drift for the same visit', async () => {
      const { visit } = await seedConfirmedVisit();
      await recompute(visit.id, 30, 55);
      await recompute(visit.id, 55, 90);

      expect(await logsFor(visit.id)).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it("one restaurant's notification log is invisible to another under RLS", async () => {
      const { visit } = await seedConfirmedVisit();
      await notifications.sendBookingConfirmation(restaurantId, visit.id);

      const asOwner = await tenantPrisma.forRestaurant(restaurantId, (tx) =>
        tx.notificationLog.findMany({ where: { visitId: visit.id } }),
      );
      const asOther = await tenantPrisma.forRestaurant(restaurantBId, (tx) =>
        tx.notificationLog.findMany({ where: { visitId: visit.id } }),
      );

      expect(asOwner).toHaveLength(1);
      expect(asOther).toHaveLength(0);
    });
  });
});
