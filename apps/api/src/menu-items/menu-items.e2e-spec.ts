import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { PasswordService } from '../auth/password.service.js';

/**
 * CP3's own deliverables, made concrete:
 *  - real validation (prepTimeMinutes never silently defaults; allergens
 *    are structured tags from a fixed set, not free text) — see
 *    docs/decisions.md.
 *  - owner-only mutation; FOH/kitchen can read but not write.
 *  - "immediately reflected" with zero cache: an availability toggle is
 *    visible on the very next read, since every read goes straight to
 *    Postgres via TenantPrismaService — this is the concrete stand-in for
 *    Part 5's "CP4 may only ever reference live MenuItem data" bar, since
 *    CP4 itself doesn't exist yet.
 *  - GET /auth/staff/me only ever returns the caller's own memberships.
 */
describe('CP3 menu item CRUD', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let passwords: PasswordService;

  const restaurantId = `test-menu-${randomUUID()}`;
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const fohEmail = `foh-${randomUUID()}@example.test`;
  const kitchenEmail = `kitchen-${randomUUID()}@example.test`;
  const plainPassword = 'correct-horse-battery-staple';

  let ownerToken: string;
  let fohToken: string;
  let kitchenToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();
    passwords = app.get(PasswordService);

    await rawPrisma.restaurant.create({
      data: {
        id: restaurantId,
        name: 'Test Menu Kitchen',
        timezone: 'UTC',
        address: '1 Test St',
        phone: '+15555550100',
        settings: {},
      },
    });

    const passwordHash = await passwords.hash(plainPassword);
    const owner = await rawPrisma.user.create({ data: { email: ownerEmail, passwordHash, name: 'Owner' } });
    const foh = await rawPrisma.user.create({ data: { email: fohEmail, passwordHash, name: 'FOH' } });
    const kitchen = await rawPrisma.user.create({ data: { email: kitchenEmail, passwordHash, name: 'Kitchen' } });
    await rawPrisma.staffMembership.create({ data: { userId: owner.id, restaurantId, role: 'owner' } });
    await rawPrisma.staffMembership.create({ data: { userId: foh.id, restaurantId, role: 'foh' } });
    await rawPrisma.staffMembership.create({ data: { userId: kitchen.id, restaurantId, role: 'kitchen' } });

    const login = async (email: string) => {
      const res = await request(app.getHttpServer()).post('/auth/staff/login').send({ email, password: plainPassword });
      return res.body.token as string;
    };
    ownerToken = await login(ownerEmail);
    fohToken = await login(fohEmail);
    kitchenToken = await login(kitchenEmail);
  });

  afterAll(async () => {
    await rawPrisma.staffMembership.deleteMany({ where: { restaurantId } });
    await rawPrisma.user.deleteMany({ where: { email: { in: [ownerEmail, fohEmail, kitchenEmail] } } });
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  const validDish = {
    name: 'Test Dish',
    price: '12.50',
    prepTimeMinutes: 10,
    category: 'main',
    allergens: ['gluten', 'dairy'],
  };

  it('rejects a missing prepTimeMinutes rather than defaulting it to 0', async () => {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'No Prep Time', price: '5.00', category: 'main' });
    expect(res.status).toBe(400);

    const found = await rawPrisma.menuItem.findFirst({ where: { restaurantId, name: 'No Prep Time' } });
    expect(found).toBeNull();
  });

  it('rejects prepTimeMinutes of 0', async () => {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Zero Prep', prepTimeMinutes: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects a negative prepTimeMinutes', async () => {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Negative Prep', prepTimeMinutes: -5 });
    expect(res.status).toBe(400);
  });

  it('rejects an allergen tag outside the fixed structured set', async () => {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Free Text Allergen', allergens: ['no peanuts please, allergic!'] });
    expect(res.status).toBe(400);
  });

  it('owner creates a dish with structured allergens persisted as an array', async () => {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validDish);
    expect(res.status).toBe(201);
    expect(res.body.allergens).toEqual(['gluten', 'dairy']);
    expect(res.body.prepTimeMinutes).toBe(10);
    expect(res.body.available).toBe(true);
  });

  it('FOH and kitchen can read the menu but cannot create or update it', async () => {
    for (const token of [fohToken, kitchenToken]) {
      const readRes = await request(app.getHttpServer())
        .get(`/restaurants/${restaurantId}/menu-items`)
        .set('Authorization', `Bearer ${token}`);
      expect(readRes.status).toBe(200);

      const createRes = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/menu-items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validDish, name: 'Should Not Be Created' });
      expect(createRes.status).toBe(403);
    }

    const notCreated = await rawPrisma.menuItem.findFirst({ where: { restaurantId, name: 'Should Not Be Created' } });
    expect(notCreated).toBeNull();
  });

  it('FOH and kitchen cannot update an existing dish', async () => {
    const created = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'FOH And Kitchen Cannot Touch This' });
    const id = created.body.id as string;

    for (const token of [fohToken, kitchenToken]) {
      const res = await request(app.getHttpServer())
        .patch(`/restaurants/${restaurantId}/menu-items/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ available: false });
      expect(res.status).toBe(403);
    }

    const unchanged = await rawPrisma.menuItem.findUniqueOrThrow({ where: { id } });
    expect(unchanged.available).toBe(true);
  });

  it('disabling a dish is immediately reflected — no cache between write and read', async () => {
    const created = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Soon Disabled' });
    const id = created.body.id as string;

    const beforeList = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/menu-items?available=true`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(beforeList.body.some((item: { id: string }) => item.id === id)).toBe(true);

    const patchRes = await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantId}/menu-items/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ available: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.available).toBe(false);

    // Immediately, same test, no delay/retry: this is what CP4's grounding
    // query would see — a "get available dishes" read must never still
    // include a dish that was just disabled.
    const afterAvailableOnly = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/menu-items?available=true`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(afterAvailableOnly.body.some((item: { id: string }) => item.id === id)).toBe(false);

    const afterGetOne = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/menu-items/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(afterGetOne.body.available).toBe(false);
  });

  it('owner edits a dish and the change is immediately reflected', async () => {
    const created = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Original Name' });
    const id = created.body.id as string;

    const patchRes = await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantId}/menu-items/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Edited Name', prepTimeMinutes: 25 });
    expect(patchRes.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/menu-items/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(getRes.body.name).toBe('Edited Name');
    expect(getRes.body.prepTimeMinutes).toBe(25);
  });

  it('a partial update omitting modifiableOptions leaves it untouched, not wiped', async () => {
    // Regression coverage for a real bug caught in code review: the admin
    // app's edit form has no modifiableOptions control yet, and an earlier
    // version of its Server Action sent `modifiableOptions: []` on every
    // save regardless — silently wiping it on every single edit. The fix
    // is that the field must be entirely absent from a partial update
    // request, and Prisma's updateMany must leave the column alone when
    // it's absent. This test pins that contract at the API level,
    // independent of whether the frontend ever regresses again.
    const created = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Has Modifiable Options', modifiableOptions: ['spice_level'] });
    const id = created.body.id as string;
    expect(created.body.modifiableOptions).toEqual(['spice_level']);

    const patchRes = await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantId}/menu-items/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Renamed, Options Should Survive' }); // no modifiableOptions key at all
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.modifiableOptions).toEqual(['spice_level']);
  });

  it('an update cannot slip prepTimeMinutes down to 0 either', async () => {
    const created = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/menu-items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validDish, name: 'Guard On Update Too' });
    const id = created.body.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantId}/menu-items/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ prepTimeMinutes: 0 });
    expect(res.status).toBe(400);

    const unchanged = await rawPrisma.menuItem.findUniqueOrThrow({ where: { id } });
    expect(unchanged.prepTimeMinutes).toBe(10);
  });

  it('GET /auth/staff/me returns only the caller\'s own memberships', async () => {
    const ownerMe = await request(app.getHttpServer())
      .get('/auth/staff/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerMe.status).toBe(200);
    expect(ownerMe.body.email).toBe(ownerEmail);
    expect(ownerMe.body.memberships).toHaveLength(1);
    expect(ownerMe.body.memberships[0]).toMatchObject({ restaurantId, role: 'owner' });

    const kitchenMe = await request(app.getHttpServer())
      .get('/auth/staff/me')
      .set('Authorization', `Bearer ${kitchenToken}`);
    expect(kitchenMe.body.email).toBe(kitchenEmail);
    expect(kitchenMe.body.memberships).toHaveLength(1);
    expect(kitchenMe.body.memberships[0]).toMatchObject({ restaurantId, role: 'kitchen' });
    // Never leaks the owner's membership row into another staff member's response.
    expect(kitchenMe.body.memberships.some((m: { role: string }) => m.role === 'owner')).toBe(false);
  });
});
