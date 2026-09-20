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
 * CP7 — manual table reassignment. The trust-critical part isn't a
 * status transition (VisitStatus never changes here), it's the same
 * atomic-conditional-UPDATE discipline CP5/CP6 established: releasing
 * the old table and claiming the new one must not be a read-then-write,
 * and two staff racing to reassign must not both win.
 */
describe('CP7 table reassignment', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let passwords: PasswordService;

  const restaurantId = `test-reassign-${randomUUID()}`;
  const restaurantBId = `test-reassign-b-${randomUUID()}`;
  let fohToken: string;
  let ownerBToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    passwords = app.get(PasswordService);

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();

    for (const [id, name] of [
      [restaurantId, 'Test Reassign Kitchen'],
      [restaurantBId, 'Test Reassign Kitchen B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550177', settings: {} },
      });
    }

    const passwordHash = await passwords.hash('correct-horse-battery-staple');
    const fohUser = await rawPrisma.user.create({
      data: { email: `foh-${randomUUID()}@example.test`, passwordHash, name: 'FOH Staff' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: fohUser.id, restaurantId, role: 'foh' } });
    const fohLogin = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: fohUser.email, password: 'correct-horse-battery-staple' });
    fohToken = fohLogin.body.token;

    const ownerBUser = await rawPrisma.user.create({
      data: { email: `owner-b-${randomUUID()}@example.test`, passwordHash, name: 'Owner B' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: ownerBUser.id, restaurantId: restaurantBId, role: 'owner' } });
    const ownerBLogin = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: ownerBUser.email, password: 'correct-horse-battery-staple' });
    ownerBToken = ownerBLogin.body.token;
  });

  afterAll(async () => {
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await deleteRestaurantCascade(rawPrisma, restaurantBId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  let labelCounter = 5000;
  function nextSuffix(): number {
    labelCounter += 1;
    return labelCounter;
  }

  async function seedTable(status: 'free' | 'held' | 'seated' = 'free', scopedRestaurantId = restaurantId) {
    const suffix = nextSuffix();
    return rawPrisma.table.create({
      data: { restaurantId: scopedRestaurantId, label: `T${suffix}`, seatsMin: 1, seatsMax: 4, features: [], status },
    });
  }

  async function seedActiveVisit(status: 'confirmed' | 'kitchen_started' = 'confirmed') {
    const table = await seedTable('held');
    const randomPhoneSuffix = Math.floor(100_000_000 + Math.random() * 899_999_999);
    const customer = await rawPrisma.customer.create({
      data: { phone: `+1555${randomPhoneSuffix}`, phoneVerifiedAt: new Date() },
    });
    const visit = await rawPrisma.visit.create({
      data: {
        restaurantId,
        customerId: customer.id,
        partySize: 2,
        arrivalEta: new Date(),
        arrivalConfirmedAt: new Date(),
        tableId: table.id,
        tableAssignedAt: new Date(),
        status,
      },
    });
    return { visit, table };
  }

  it('happy path: reassigns the table, releases the old one, claims the new one', async () => {
    const { visit, table: oldTable } = await seedActiveVisit();
    const newTable = await seedTable('free');

    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/dashboard/visits/${visit.id}/reassign-table`)
      .set('Authorization', `Bearer ${fohToken}`)
      .send({ newTableId: newTable.id });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ visitId: visit.id, tableId: newTable.id, alreadyAssigned: false });

    const persistedVisit = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
    expect(persistedVisit.tableId).toBe(newTable.id);

    const persistedOldTable = await rawPrisma.table.findUniqueOrThrow({ where: { id: oldTable.id } });
    expect(persistedOldTable.status).toBe('free');
    const persistedNewTable = await rawPrisma.table.findUniqueOrThrow({ where: { id: newTable.id } });
    expect(persistedNewTable.status).toBe('held');
  });

  it('reassigning to the table it already has is an idempotent no-op, not an error', async () => {
    const { visit, table } = await seedActiveVisit();

    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/dashboard/visits/${visit.id}/reassign-table`)
      .set('Authorization', `Bearer ${fohToken}`)
      .send({ newTableId: table.id });

    expect(res.status).toBe(201);
    expect(res.body.alreadyAssigned).toBe(true);
    const persisted = await rawPrisma.table.findUniqueOrThrow({ where: { id: table.id } });
    expect(persisted.status).toBe('held'); // untouched, never released-then-reclaimed
  });

  it('rejects reassigning to a table that is not free', async () => {
    const { visit } = await seedActiveVisit();
    const takenTable = await seedTable('held');

    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/dashboard/visits/${visit.id}/reassign-table`)
      .set('Authorization', `Bearer ${fohToken}`)
      .send({ newTableId: takenTable.id });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('table_taken');
  });

  it('rejects reassignment for a visit with no active table need (e.g. already food_out)', async () => {
    const { visit } = await seedActiveVisit();
    await rawPrisma.visit.update({ where: { id: visit.id }, data: { status: 'food_out' } });
    const newTable = await seedTable('free');

    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/dashboard/visits/${visit.id}/reassign-table`)
      .set('Authorization', `Bearer ${fohToken}`)
      .send({ newTableId: newTable.id });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('visit_not_active');
  });

  describe('CONCURRENCY: two visits racing to claim the same free table', () => {
    it('exactly one reassignment succeeds; the other gets an honest "that table just went"', async () => {
      const { visit: visitX } = await seedActiveVisit();
      const { visit: visitY } = await seedActiveVisit();
      const contestedTable = await seedTable('free');

      const [resX, resY] = await Promise.all([
        request(app.getHttpServer())
          .post(`/restaurants/${restaurantId}/dashboard/visits/${visitX.id}/reassign-table`)
          .set('Authorization', `Bearer ${fohToken}`)
          .send({ newTableId: contestedTable.id }),
        request(app.getHttpServer())
          .post(`/restaurants/${restaurantId}/dashboard/visits/${visitY.id}/reassign-table`)
          .set('Authorization', `Bearer ${fohToken}`)
          .send({ newTableId: contestedTable.id }),
      ]);

      const statuses = [resX.status, resY.status].sort();
      expect(statuses).toEqual([201, 409]);

      const persistedTable = await rawPrisma.table.findUniqueOrThrow({ where: { id: contestedTable.id } });
      expect(persistedTable.status).toBe('held'); // exactly one claim landed, not zero, not double

      const winnerVisitId = resX.status === 201 ? visitX.id : visitY.id;
      const persistedWinner = await rawPrisma.visit.findUniqueOrThrow({ where: { id: winnerVisitId } });
      expect(persistedWinner.tableId).toBe(contestedTable.id);
    });
  });

  describe('tenant isolation', () => {
    it("restaurant B's staff cannot reassign restaurant A's visit's table, and get a 404", async () => {
      const { visit, table } = await seedActiveVisit();
      const newTable = await seedTable('free');

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/dashboard/visits/${visit.id}/reassign-table`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ newTableId: newTable.id });

      expect(res.status).toBe(404);
      const persisted = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(persisted.tableId).toBe(table.id); // untouched
    });
  });
});
