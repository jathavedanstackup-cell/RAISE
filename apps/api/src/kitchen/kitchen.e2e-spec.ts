import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { PasswordService } from '../auth/password.service.js';

/**
 * CP8 — kitchen display.
 *
 * The two properties that matter most here are the ones a careless future
 * refactor would break silently:
 *  - a ticket with allergy flags cannot reach `food_out` without an
 *    acknowledgment
 *  - acknowledging does not change what the kitchen sees
 * The second is also pinned statically in kitchen-invariants.spec.ts,
 * because a behavioural test alone cannot stop a UI-side edit.
 */
describe('CP8 kitchen display', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let passwords: PasswordService;

  const restaurantId = `test-kds-${randomUUID()}`;
  const restaurantBId = `test-kds-b-${randomUUID()}`;
  let staffToken: string;
  let staffBToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    passwords = app.get(PasswordService);

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();

    for (const [id, name] of [
      [restaurantId, 'Test KDS'],
      [restaurantBId, 'Test KDS B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550188', settings: {} },
      });
    }

    const passwordHash = await passwords.hash('correct-horse-battery-staple');

    const staffUser = await rawPrisma.user.create({
      data: { email: `kds-${randomUUID()}@example.test`, passwordHash, name: 'KDS Staff' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: staffUser.id, restaurantId, role: 'owner' } });
    const login = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffUser.email, password: 'correct-horse-battery-staple' });
    staffToken = login.body.token;

    const staffBUser = await rawPrisma.user.create({
      data: { email: `kds-b-${randomUUID()}@example.test`, passwordHash, name: 'KDS Staff B' },
    });
    await rawPrisma.staffMembership.create({
      data: { userId: staffBUser.id, restaurantId: restaurantBId, role: 'owner' },
    });
    const loginB = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffBUser.email, password: 'correct-horse-battery-staple' });
    staffBToken = loginB.body.token;
  });

  afterAll(async () => {
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await deleteRestaurantCascade(rawPrisma, restaurantBId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  let counter = 8000;
  const nextSuffix = () => (counter += 1);

  const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  async function seedTicket(opts: {
    kitchenStartTarget: Date;
    allergyFlags?: string[];
    status?: 'confirmed' | 'kitchen_started';
    owner?: string;
  }) {
    const suffix = nextSuffix();
    const owner = opts.owner ?? restaurantId;
    const dish = await rawPrisma.menuItem.create({
      data: {
        restaurantId: owner,
        name: `Dish ${suffix}`,
        price: '15.00',
        prepTimeMinutes: 12,
        category: 'main',
        allergens: [],
        modifiableOptions: [],
        available: true,
      },
    });
    const table = await rawPrisma.table.create({
      data: { restaurantId: owner, label: `K${suffix}`, seatsMin: 1, seatsMax: 4, features: [], status: 'held' },
    });
    const customer = await rawPrisma.customer.create({
      data: { phone: `+1555${Math.floor(100_000_000 + Math.random() * 899_999_999)}`, phoneVerifiedAt: new Date() },
    });
    const visit = await rawPrisma.visit.create({
      data: {
        restaurantId: owner,
        customerId: customer.id,
        tableId: table.id,
        partySize: 2,
        arrivalEta: minutesFromNow(20),
        status: opts.status ?? 'kitchen_started',
        kitchenStartTarget: opts.kitchenStartTarget,
        foodOutTarget: new Date(opts.kitchenStartTarget.getTime() + 20 * 60_000),
      },
    });
    await rawPrisma.visitItem.create({
      data: {
        restaurantId: owner,
        visitId: visit.id,
        menuItemId: dish.id,
        quantity: 1,
        modifications: [],
        allergyFlags: opts.allergyFlags ?? [],
      },
    });
    return { visit, table, dish };
  }

  const queue = (token = staffToken, id = restaurantId) =>
    request(app.getHttpServer()).get(`/restaurants/${id}/kitchen/queue`).set('Authorization', `Bearer ${token}`);

  describe('prep queue', () => {
    it('orders by computed kitchen start, not by when the order came in', async () => {
      const later = await seedTicket({ kitchenStartTarget: minutesFromNow(-2) });
      const sooner = await seedTicket({ kitchenStartTarget: minutesFromNow(-30) });

      const res = await queue().expect(200);
      const ids = res.body.tickets.map((t: { visitId: string }) => t.visitId);
      const a = ids.indexOf(sooner.visit.id);
      const b = ids.indexOf(later.visit.id);

      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      // `sooner` was created SECOND, so order-in sequence would put it last.
      // It must come first, because its computed start time is earlier.
      expect(a).toBeLessThan(b);
    });

    it('does not show a ticket before its computed start time', async () => {
      const future = await seedTicket({ kitchenStartTarget: minutesFromNow(45) });
      const due = await seedTicket({ kitchenStartTarget: minutesFromNow(-1) });

      const res = await queue().expect(200);
      const ids = res.body.tickets.map((t: { visitId: string }) => t.visitId);

      expect(ids).toContain(due.visit.id);
      expect(ids).not.toContain(future.visit.id);
    });

    it('reports allergy flags on the ticket, de-duplicated across the order', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: ['peanuts', 'dairy'] });
      const res = await queue().expect(200);
      const ticket = res.body.tickets.find((t: { visitId: string }) => t.visitId === visit.id);

      expect(ticket.allergyFlags.sort()).toEqual(['dairy', 'peanuts']);
      expect(ticket.allergyAcknowledgedAt).toBeNull();
    });
  });

  describe('allergy acknowledgment', () => {
    const ack = (visitId: string, token = staffToken, id = restaurantId) =>
      request(app.getHttpServer())
        .post(`/restaurants/${id}/kitchen/visits/${visitId}/allergy-ack`)
        .set('Authorization', `Bearer ${token}`);

    it('NEVER DISMISS: the flags are byte-identical before and after acknowledgment', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: ['peanuts'] });

      const before = (await queue().expect(200)).body.tickets.find(
        (t: { visitId: string }) => t.visitId === visit.id,
      );
      await ack(visit.id).expect(201);
      const after = (await queue().expect(200)).body.tickets.find((t: { visitId: string }) => t.visitId === visit.id);

      // The whole point of the CP8 decision: acknowledging records that a
      // human looked. It does not quieten, hide, or otherwise alter the
      // warning. Only the audit timestamp may differ.
      expect(after.allergyFlags).toEqual(before.allergyFlags);
      expect(after.items).toEqual(before.items);
      expect(before.allergyAcknowledgedAt).toBeNull();
      expect(after.allergyAcknowledgedAt).not.toBeNull();
    });

    it('is idempotent: a double-tap returns the first acknowledgment, not a second audit row', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: ['dairy'] });

      const first = await ack(visit.id).expect(201);
      const second = await ack(visit.id).expect(201);

      expect(first.body.alreadyAcknowledged).toBe(false);
      expect(second.body.alreadyAcknowledged).toBe(true);
      expect(second.body.acknowledgedAt).toBe(first.body.acknowledgedAt);

      const rows = await rawPrisma.visitAllergyAcknowledgment.findMany({ where: { visitId: visit.id } });
      expect(rows).toHaveLength(1);
    });
  });

  describe('food out gate', () => {
    const foodOut = (visitId: string, token = staffToken, id = restaurantId) =>
      request(app.getHttpServer())
        .post(`/restaurants/${id}/kitchen/visits/${visitId}/food-out`)
        .set('Authorization', `Bearer ${token}`);

    const ack = (visitId: string) =>
      request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/kitchen/visits/${visitId}/allergy-ack`)
        .set('Authorization', `Bearer ${staffToken}`);

    it('refuses to send out an order with unacknowledged allergy flags', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: ['peanuts'] });

      const res = await foodOut(visit.id).expect(409);
      expect(res.body.reason).toBe('allergy_not_acknowledged');

      const after = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(after.status).toBe('kitchen_started');
    });

    it('allows an order with no allergy flags straight through -- the gate is not a blanket confirmation step', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: [] });

      await foodOut(visit.id).expect(201);
      const after = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(after.status).toBe('food_out');
    });

    it('allows a flagged order once acknowledged, and writes a full audit event', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: ['shellfish'] });

      await ack(visit.id).expect(201);
      await foodOut(visit.id).expect(201);

      const after = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(after.status).toBe('food_out');

      const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId: visit.id, status: 'food_out' } });
      expect(events).toHaveLength(1);
      expect(events[0]!.actorType).toBe('staff');
      expect(events[0]!.mechanism).toBe('kitchen_food_out_endpoint');
    });

    it('double food-out is idempotent, not a conflict', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1) });

      const first = await foodOut(visit.id).expect(201);
      const second = await foodOut(visit.id).expect(201);

      expect(first.body.alreadyServed).toBe(false);
      expect(second.body.alreadyServed).toBe(true);

      const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId: visit.id, status: 'food_out' } });
      expect(events).toHaveLength(1);
    });

    it('refuses a ticket the kitchen never accepted', async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), status: 'confirmed' });

      const res = await foodOut(visit.id).expect(409);
      expect(res.body.reason).toBe('not_in_progress');
    });
  });

  describe('tenant isolation', () => {
    it("restaurant B's kitchen never sees restaurant A's tickets", async () => {
      const mine = await seedTicket({ kitchenStartTarget: minutesFromNow(-1) });

      const res = await queue(staffBToken, restaurantBId).expect(200);
      const ids = res.body.tickets.map((t: { visitId: string }) => t.visitId);
      expect(ids).not.toContain(mine.visit.id);
    });

    it("restaurant B's staff cannot acknowledge or send out restaurant A's visit, and get a 404", async () => {
      const { visit } = await seedTicket({ kitchenStartTarget: minutesFromNow(-1), allergyFlags: ['peanuts'] });

      await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/kitchen/visits/${visit.id}/allergy-ack`)
        .set('Authorization', `Bearer ${staffBToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/kitchen/visits/${visit.id}/food-out`)
        .set('Authorization', `Bearer ${staffBToken}`)
        .expect(404);

      const after = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(after.status).toBe('kitchen_started');
    });
  });
});
