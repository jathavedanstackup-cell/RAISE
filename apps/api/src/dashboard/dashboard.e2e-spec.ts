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

describe('CP7 dashboard reads ("Tonight — Inbound")', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let passwords: PasswordService;

  const restaurantId = `test-dashboard-${randomUUID()}`;
  const restaurantBId = `test-dashboard-b-${randomUUID()}`;
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
      [restaurantId, 'Test Dashboard Kitchen'],
      [restaurantBId, 'Test Dashboard Kitchen B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550155', settings: {} },
      });
    }

    const passwordHash = await passwords.hash('correct-horse-battery-staple');
    const staffUser = await rawPrisma.user.create({
      data: { email: `dashboard-${randomUUID()}@example.test`, passwordHash, name: 'Dashboard Staff' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: staffUser.id, restaurantId, role: 'owner' } });
    const login = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: staffUser.email, password: 'correct-horse-battery-staple' });
    staffToken = login.body.token;

    const staffBUser = await rawPrisma.user.create({
      data: { email: `dashboard-b-${randomUUID()}@example.test`, passwordHash, name: 'Dashboard Staff B' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: staffBUser.id, restaurantId: restaurantBId, role: 'owner' } });
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

  let labelCounter = 6000;
  function nextSuffix(): number {
    labelCounter += 1;
    return labelCounter;
  }

  it('lists an active visit with its table, order, and allergy flags -- and never a draft or completed one', async () => {
    const suffix = nextSuffix();
    const dish = await rawPrisma.menuItem.create({
      data: {
        restaurantId,
        name: `Dish ${suffix}`,
        price: '15.00',
        prepTimeMinutes: 10,
        category: 'main',
        allergens: [],
        modifiableOptions: [],
        available: true,
      },
    });
    const table = await rawPrisma.table.create({
      data: { restaurantId, label: `T${suffix}`, seatsMin: 1, seatsMax: 4, features: [], status: 'held' },
    });
    const customer = await rawPrisma.customer.create({
      data: { phone: `+1555${Math.floor(100_000_000 + Math.random() * 899_999_999)}`, phoneVerifiedAt: new Date() },
    });
    const arrivalEta = new Date(Date.UTC(2026, 5, 15, 20, 15));
    const activeVisit = await rawPrisma.visit.create({
      data: {
        restaurantId,
        customerId: customer.id,
        partySize: 4,
        arrivalEta,
        arrivalConfirmedAt: new Date(),
        tableId: table.id,
        tableAssignedAt: new Date(),
        status: 'confirmed',
        kitchenStartTarget: new Date(Date.UTC(2026, 5, 15, 19, 58)),
        foodOutTarget: new Date(Date.UTC(2026, 5, 15, 20, 18)),
        visitItems: {
          create: [{ restaurantId, menuItemId: dish.id, quantity: 2, modifications: [], allergyFlags: ['no_peanuts'] }],
        },
      },
    });

    // A draft and a completed visit at the same restaurant -- neither should ever appear on "Tonight — Inbound".
    await rawPrisma.visit.create({ data: { restaurantId, partySize: 2, status: 'draft' } });
    const doneTable = await rawPrisma.table.create({
      data: { restaurantId, label: `T${nextSuffix()}`, seatsMin: 1, seatsMax: 4, features: [], status: 'free' },
    });
    await rawPrisma.visit.create({
      data: { restaurantId, partySize: 2, arrivalEta: new Date(), tableId: doneTable.id, status: 'completed' },
    });

    const res = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/dashboard/visits`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
    const [visit] = res.body.visits;
    expect(visit.id).toBe(activeVisit.id);
    expect(visit.partySize).toBe(4);
    expect(visit.table).toEqual({ id: table.id, label: table.label });
    expect(visit.items).toHaveLength(1);
    expect(visit.items[0]).toMatchObject({ name: dish.name, quantity: 2, allergyFlags: ['no_peanuts'] });
    expect(visit.kitchenStartTarget).toBe('2026-06-15T19:58:00.000Z');
    expect(visit.foodOutTarget).toBe('2026-06-15T20:18:00.000Z');
  });

  it('lists tables with their current availability status', async () => {
    const table = await rawPrisma.table.create({
      data: { restaurantId, label: `T${nextSuffix()}`, seatsMin: 2, seatsMax: 4, features: [], status: 'free' },
    });

    const res = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/dashboard/tables`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: table.id, label: table.label, status: 'free' })]),
    );
  });

  describe('tenant isolation', () => {
    it("restaurant B's staff cannot list restaurant A's inbound visits", async () => {
      const res = await request(app.getHttpServer())
        .get(`/restaurants/${restaurantId}/dashboard/visits`)
        .set('Authorization', `Bearer ${staffBToken}`)
        .send();

      expect(res.status).toBe(404);
    });
  });
});
