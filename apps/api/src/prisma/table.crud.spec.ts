import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('Table CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-table-${randomUUID()}`;
  let tableId: string;

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

  it('creates a table scoped to its restaurant, defaulting to free', async () => {
    const table = await prisma.table.create({
      data: {
        restaurantId,
        label: 'T9',
        seatsMin: 2,
        seatsMax: 4,
        features: ['high_chair_ok'],
      },
    });
    tableId = table.id;
    expect(table.status).toBe('free');
  });

  it('reads it back', async () => {
    const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    expect(table.label).toBe('T9');
  });

  it('updates status', async () => {
    const updated = await prisma.table.update({ where: { id: tableId }, data: { status: 'held' } });
    expect(updated.status).toBe('held');
  });

  it('deletes it', async () => {
    await prisma.table.delete({ where: { id: tableId } });
    await expect(prisma.table.findUniqueOrThrow({ where: { id: tableId } })).rejects.toThrow();
  });
});
