import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * A standalone PrismaClient for tests — same adapter wiring as
 * PrismaService, but not going through Nest's DI so specs can use it
 * directly without bootstrapping a module.
 */
export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

/**
 * Deletes a restaurant and everything under it, in FK-safe order. Test
 * teardown helper only — cascade deletes at the Visit level handle
 * VisitItem/ConversationTurn/NotificationLog/VisitStatusEvent, so this
 * just needs to clear Visit/MenuItem/Table before the Restaurant itself.
 */
export async function deleteRestaurantCascade(prisma: PrismaClient, restaurantId: string) {
  await prisma.visit.deleteMany({ where: { restaurantId } });
  await prisma.menuItem.deleteMany({ where: { restaurantId } });
  await prisma.table.deleteMany({ where: { restaurantId } });
  await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
}
