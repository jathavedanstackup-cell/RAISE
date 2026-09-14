import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CP2's own "done when" bar, made concrete: a staff user from Restaurant A
 * cannot read or write Restaurant B's data. This is the explicit,
 * automated, CI-running test the checkpoint requires — not a manual check
 * or a code-reading argument.
 *
 * Covers both isolation axes named in the checkpoint:
 *   1. Tenant  — staff A vs. staff B, including direct-object-reference
 *      attempts (not just list endpoints).
 *   2. Audience — a customer token must not reach restaurant-side routes;
 *      roles are enforced within a restaurant a staff member does belong to.
 * Plus a direct database-level check that RLS itself fails closed,
 * independent of any application guard.
 */
describe('CP2 tenant isolation', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient; // superuser connection — seeds fixtures, bypasses RLS
  let passwords: PasswordService;

  const restaurantA = `test-tenant-a-${randomUUID()}`;
  const restaurantB = `test-tenant-b-${randomUUID()}`;
  const ownerAEmail = `owner-a-${randomUUID()}@example.test`;
  const fohAEmail = `foh-a-${randomUUID()}@example.test`;
  const ownerBEmail = `owner-b-${randomUUID()}@example.test`;
  const plainPassword = 'correct-horse-battery-staple';

  let ownerAToken: string;
  let fohAToken: string;
  let customerToken: string;
  let menuItemAId: string;
  let menuItemBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();
    passwords = app.get(PasswordService);

    for (const [id, name] of [
      [restaurantA, 'Test Restaurant A'],
      [restaurantB, 'Test Restaurant B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550100', settings: {} },
      });
    }

    const passwordHash = await passwords.hash(plainPassword);
    const ownerA = await rawPrisma.user.create({
      data: { email: ownerAEmail, passwordHash, name: 'Owner A' },
    });
    const fohA = await rawPrisma.user.create({
      data: { email: fohAEmail, passwordHash, name: 'FOH A' },
    });
    const ownerB = await rawPrisma.user.create({
      data: { email: ownerBEmail, passwordHash, name: 'Owner B' },
    });
    await rawPrisma.staffMembership.create({
      data: { userId: ownerA.id, restaurantId: restaurantA, role: 'owner' },
    });
    await rawPrisma.staffMembership.create({
      data: { userId: fohA.id, restaurantId: restaurantA, role: 'foh' },
    });
    await rawPrisma.staffMembership.create({
      data: { userId: ownerB.id, restaurantId: restaurantB, role: 'owner' },
    });

    const menuItemA = await rawPrisma.menuItem.create({
      data: {
        restaurantId: restaurantA,
        name: 'A-only dish',
        price: '10.00',
        prepTimeMinutes: 5,
        allergens: [],
        modifiableOptions: [],
        category: 'main',
      },
    });
    menuItemAId = menuItemA.id;
    const menuItemB = await rawPrisma.menuItem.create({
      data: {
        restaurantId: restaurantB,
        name: 'B-only dish',
        price: '12.00',
        prepTimeMinutes: 5,
        allergens: [],
        modifiableOptions: [],
        category: 'main',
      },
    });
    menuItemBId = menuItemB.id;

    const ownerALogin = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: ownerAEmail, password: plainPassword });
    ownerAToken = ownerALogin.body.token;

    const fohALogin = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: fohAEmail, password: plainPassword });
    fohAToken = fohALogin.body.token;

    const customerPhone = `+1555555${Math.floor(1000 + Math.random() * 8999)}`;
    await request(app.getHttpServer()).post('/auth/customer/otp/request').send({ phone: customerPhone });
    const customerVerify = await request(app.getHttpServer())
      .post('/auth/customer/otp/verify')
      .send({ phone: customerPhone, code: process.env.OTP_DEV_FIXED_CODE });
    customerToken = customerVerify.body.token;
  });

  afterAll(async () => {
    await rawPrisma.staffMembership.deleteMany({ where: { restaurantId: { in: [restaurantA, restaurantB] } } });
    await rawPrisma.user.deleteMany({ where: { email: { in: [ownerAEmail, fohAEmail, ownerBEmail] } } });
    await deleteRestaurantCascade(rawPrisma, restaurantA);
    await deleteRestaurantCascade(rawPrisma, restaurantB);
    await rawPrisma.$disconnect();
    await app.close();
  });

  it('logs staff A in and lists only restaurant A menu items', async () => {
    expect(ownerAToken).toBeTruthy();
    const res = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantA}/menu-items`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(menuItemAId);
  });

  it('refuses staff A listing restaurant B (no membership) with 404, not 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantB}/menu-items`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(res.status).toBe(404);
  });

  it('refuses a direct-object-reference read of restaurant B item via restaurant A scope', async () => {
    const res = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantA}/menu-items/${menuItemBId}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(res.status).toBe(404);
  });

  it('refuses a direct-object-reference write (PATCH) of restaurant B item via restaurant A scope', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantA}/menu-items/${menuItemBId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'hijacked' });
    expect(res.status).toBe(404);

    const stillIntact = await rawPrisma.menuItem.findUniqueOrThrow({ where: { id: menuItemBId } });
    expect(stillIntact.name).toBe('B-only dish');
  });

  it('refuses staff A creating a menu item directly under restaurant B', async () => {
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantB}/menu-items`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'smuggled', price: '1.00', prepTimeMinutes: 1, category: 'main' });
    expect(res.status).toBe(404);
  });

  it('allows FOH A to read but refuses FOH A creating a menu item (role check, 403 not 404)', async () => {
    const readRes = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantA}/menu-items`)
      .set('Authorization', `Bearer ${fohAToken}`);
    expect(readRes.status).toBe(200);

    const createRes = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantA}/menu-items`)
      .set('Authorization', `Bearer ${fohAToken}`)
      .send({ name: 'new dish', price: '1.00', prepTimeMinutes: 1, category: 'main' });
    expect(createRes.status).toBe(403);
  });

  it('refuses a customer token on a restaurant-side endpoint', async () => {
    expect(customerToken).toBeTruthy();
    const res = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantA}/menu-items`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(401);
  });

  it('refuses a request with no token at all', async () => {
    const res = await request(app.getHttpServer()).get(`/restaurants/${restaurantA}/menu-items`);
    expect(res.status).toBe(401);
  });

  it('RLS itself fails closed at the database level, independent of any app guard', async () => {
    // The app's own runtime PrismaService, connected as the restricted
    // raise_app role, queried directly with no tenant scope set at all
    // (no forRestaurant, no bypassScope). If RLS were misconfigured or a
    // future query forgot to go through TenantPrismaService, this is what
    // would either save or fail to save it.
    const prismaService = app.get(PrismaService);
    const unscopedResult = await prismaService.menuItem.findMany({
      where: { id: { in: [menuItemAId, menuItemBId] } },
    });
    expect(unscopedResult).toHaveLength(0);
  });
});
