import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('Visit CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-visit-${randomUUID()}`;
  let tableId: string;
  let visitId: string;

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
    const table = await prisma.table.create({
      data: { restaurantId, label: 'T1', seatsMin: 2, seatsMax: 2, features: [] },
    });
    tableId = table.id;
  });

  afterAll(async () => {
    await deleteRestaurantCascade(prisma, restaurantId);
    await prisma.$disconnect();
  });

  it('creates a draft visit, unassigned', async () => {
    const visit = await prisma.visit.create({
      data: {
        restaurantId,
        partySize: 3,
        specialNeeds: ['high_chair'],
        arrivalEta: new Date('2026-09-13T20:15:00Z'),
      },
    });
    visitId = visit.id;
    expect(visit.status).toBe('draft');
    expect(visit.tableId).toBeNull();
  });

  it('reads it back', async () => {
    const visit = await prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit.partySize).toBe(3);
  });

  it('confirms it and assigns a table', async () => {
    const updated = await prisma.visit.update({
      where: { id: visitId },
      data: {
        status: 'confirmed',
        arrivalConfirmedAt: new Date(),
        tableId,
        tableAssignedAt: new Date(),
      },
    });
    expect(updated.status).toBe('confirmed');
    expect(updated.tableId).toBe(tableId);
  });

  it('deletes it', async () => {
    await prisma.visit.delete({ where: { id: visitId } });
    await expect(prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).rejects.toThrow();
  });
});
