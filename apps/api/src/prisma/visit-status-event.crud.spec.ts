import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('VisitStatusEvent CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-statusevent-${randomUUID()}`;
  let visitId: string;
  let eventId: string;

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
    const visit = await prisma.visit.create({
      data: { restaurantId, partySize: 2, arrivalEta: new Date('2026-09-13T20:15:00Z') },
    });
    visitId = visit.id;
  });

  afterAll(async () => {
    await deleteRestaurantCascade(prisma, restaurantId);
    await prisma.$disconnect();
  });

  it('records a status transition as its own timestamped row', async () => {
    const event = await prisma.visitStatusEvent.create({
      data: { restaurantId, visitId, status: 'draft' },
    });
    eventId = event.id;
    expect(event.status).toBe('draft');
  });

  it('reads it back', async () => {
    const event = await prisma.visitStatusEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('builds an append-only audit trail — each transition is a new row, not an overwrite', async () => {
    await prisma.visitStatusEvent.create({ data: { restaurantId, visitId, status: 'confirmed' } });
    await prisma.visitStatusEvent.create({
      data: { restaurantId, visitId, status: 'kitchen_started' },
    });

    const trail = await prisma.visitStatusEvent.findMany({
      where: { visitId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(trail.map((e) => e.status)).toEqual(['draft', 'confirmed', 'kitchen_started']);
  });

  it('cascade-deletes when its visit is deleted', async () => {
    await prisma.visit.delete({ where: { id: visitId } });
    const remaining = await prisma.visitStatusEvent.findMany({ where: { visitId } });
    expect(remaining).toHaveLength(0);
  });
});
