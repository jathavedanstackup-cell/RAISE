import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('VisitItem CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-visititem-${randomUUID()}`;
  let visitId: string;
  let menuItemId: string;
  let visitItemId: string;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.$connect();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        name: 'Test Kitchen',
        timezone: 'America/Los_Angeles',
        address: '1 Test St',
        phone: '+15555550100',
        settings: {},
      },
    });
    const menuItem = await prisma.menuItem.create({
      data: {
        restaurantId,
        name: 'Test Curry',
        price: '12.50',
        prepTimeMinutes: 10,
        allergens: [],
        modifiableOptions: [],
        category: 'main',
      },
    });
    menuItemId = menuItem.id;
    const visit = await prisma.visit.create({
      data: { restaurantId, partySize: 2, arrivalEta: new Date('2026-09-13T20:15:00Z') },
    });
    visitId = visit.id;
  });

  afterAll(async () => {
    await deleteRestaurantCascade(prisma, restaurantId);
    await prisma.$disconnect();
  });

  it('creates a visit item with structured allergy flags, not free text', async () => {
    const item = await prisma.visitItem.create({
      data: {
        restaurantId,
        visitId,
        menuItemId,
        quantity: 2,
        modifications: ['spice_level:mild'],
        allergyFlags: ['no_peanuts'],
      },
    });
    visitItemId = item.id;
    expect(item.allergyFlags).toEqual(['no_peanuts']);
  });

  it('reads it back', async () => {
    const item = await prisma.visitItem.findUniqueOrThrow({ where: { id: visitItemId } });
    expect(item.quantity).toBe(2);
  });

  it('updates quantity', async () => {
    const updated = await prisma.visitItem.update({
      where: { id: visitItemId },
      data: { quantity: 3 },
    });
    expect(updated.quantity).toBe(3);
  });

  it('cascade-deletes when its visit is deleted', async () => {
    await prisma.visit.delete({ where: { id: visitId } });
    await expect(prisma.visitItem.findUniqueOrThrow({ where: { id: visitItemId } })).rejects.toThrow();
  });
});
