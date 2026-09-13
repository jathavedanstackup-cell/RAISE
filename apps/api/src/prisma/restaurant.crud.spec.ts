import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('Restaurant CRUD', () => {
  let prisma: PrismaClient;
  const id = `test-restaurant-crud-${randomUUID()}`;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await deleteRestaurantCascade(prisma, id);
    await prisma.$disconnect();
  });

  it('creates a restaurant', async () => {
    const restaurant = await prisma.restaurant.create({
      data: {
        id,
        name: 'Test Kitchen',
        timezone: 'America/Los_Angeles',
        address: '1 Test St',
        phone: '+15555550100',
        settings: { avgPrepBufferMinutes: 5, tableHoldWindowMinutes: 20 },
      },
    });

    expect(restaurant.id).toBe(id);
    expect(restaurant.name).toBe('Test Kitchen');
  });

  it('reads it back', async () => {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id } });
    expect(restaurant.timezone).toBe('America/Los_Angeles');
  });

  it('updates it', async () => {
    const updated = await prisma.restaurant.update({
      where: { id },
      data: { name: 'Test Kitchen (renamed)' },
    });
    expect(updated.name).toBe('Test Kitchen (renamed)');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updated.createdAt.getTime());
  });

  it('deletes it', async () => {
    await prisma.restaurant.delete({ where: { id } });
    await expect(prisma.restaurant.findUniqueOrThrow({ where: { id } })).rejects.toThrow();
  });
});
