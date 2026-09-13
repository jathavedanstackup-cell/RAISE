import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('ConversationTurn CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-convturn-${randomUUID()}`;
  let visitId: string;
  let turnId: string;

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

  it('creates a conversation turn with a structured delta', async () => {
    const turn = await prisma.conversationTurn.create({
      data: {
        restaurantId,
        visitId,
        role: 'customer',
        transcript: 'Table for two around 8:15, please.',
        structuredDelta: { partySize: 2, arrivalEta: '2026-09-13T20:15:00Z' },
      },
    });
    turnId = turn.id;
    expect(turn.role).toBe('customer');
  });

  it('reads it back', async () => {
    const turn = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    expect(turn.transcript).toContain('Table for two');
  });

  it('lists turns for a visit in order', async () => {
    await prisma.conversationTurn.create({
      data: {
        restaurantId,
        visitId,
        role: 'system',
        transcript: 'Got it — table for two, arriving 8:15.',
      },
    });
    const turns = await prisma.conversationTurn.findMany({
      where: { visitId },
      orderBy: { createdAt: 'asc' },
    });
    expect(turns).toHaveLength(2);
    expect(turns[1].role).toBe('system');
  });

  it('cascade-deletes when its visit is deleted', async () => {
    await prisma.visit.delete({ where: { id: visitId } });
    const remaining = await prisma.conversationTurn.findMany({ where: { visitId } });
    expect(remaining).toHaveLength(0);
  });
});
