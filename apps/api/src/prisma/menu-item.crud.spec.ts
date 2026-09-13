import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('MenuItem CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-menuitem-${randomUUID()}`;
  let menuItemId: string;

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
  });

  afterAll(async () => {
    await deleteRestaurantCascade(prisma, restaurantId);
    await prisma.$disconnect();
  });

  it('creates a menu item scoped to its restaurant', async () => {
    const item = await prisma.menuItem.create({
      data: {
        restaurantId,
        name: 'Test Curry',
        price: '12.50',
        prepTimeMinutes: 10,
        allergens: ['dairy'],
        modifiableOptions: ['spice_level'],
        category: 'main',
      },
    });
    menuItemId = item.id;
    expect(item.restaurantId).toBe(restaurantId);
    expect(item.price.toString()).toBe('12.5');
    expect(item.allergens).toEqual(['dairy']);
  });

  it('reads it back', async () => {
    const item = await prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } });
    expect(item.name).toBe('Test Curry');
  });

  it('updates availability', async () => {
    const updated = await prisma.menuItem.update({
      where: { id: menuItemId },
      data: { available: false },
    });
    expect(updated.available).toBe(false);
  });

  it('deletes it', async () => {
    await prisma.menuItem.delete({ where: { id: menuItemId } });
    await expect(prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } })).rejects.toThrow();
  });
});
