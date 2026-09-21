import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from './test-fixtures.js';

describe('NotificationLog CRUD', () => {
  let prisma: PrismaClient;
  const restaurantId = `test-restaurant-notiflog-${randomUUID()}`;
  let visitId: string;
  let logId: string;

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

  it('creates a pending notification log entry', async () => {
    const log = await prisma.notificationLog.create({
      data: {
        restaurantId,
        visitId,
        // CP9 added `type` (NOT NULL) and the @@unique([visitId, type]) that
        // makes it the idempotency claim key.
        type: 'booking_confirmation',
        channel: 'sms',
        payload: { template: 'booking_confirmed' },
      },
    });
    logId = log.id;
    expect(log.status).toBe('pending');
    expect(log.sentAt).toBeNull();
  });

  it('reads it back', async () => {
    const log = await prisma.notificationLog.findUniqueOrThrow({ where: { id: logId } });
    expect(log.channel).toBe('sms');
  });

  it('marks it sent', async () => {
    const updated = await prisma.notificationLog.update({
      where: { id: logId },
      data: { status: 'sent', sentAt: new Date() },
    });
    expect(updated.status).toBe('sent');
    expect(updated.sentAt).not.toBeNull();
  });

  it('cascade-deletes when its visit is deleted', async () => {
    await prisma.visit.delete({ where: { id: visitId } });
    const remaining = await prisma.notificationLog.findMany({ where: { visitId } });
    expect(remaining).toHaveLength(0);
  });
});
