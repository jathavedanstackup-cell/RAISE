import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient } from './test-fixtures.js';

/**
 * Regression test for the CP3 pre-merge security fix.
 *
 * `self_membership_lookup` was originally created without a FOR clause,
 * which Postgres defaults to FOR ALL -- so it covered INSERT/UPDATE/DELETE
 * as well as SELECT, carrying a WITH CHECK that constrained only user_id
 * and said nothing about restaurant_id. Because permissive policies are
 * ORed, any authenticated staff member could INSERT
 * {user_id: self, restaurant_id: <any>, role: 'owner'}: tenant_isolation
 * rejected that row, but this policy accepted it, so the write succeeded.
 * That is self-service cross-tenant access, and it also allowed promoting
 * one's own row from 'foh' to 'owner'.
 *
 * raise_app holds INSERT/UPDATE on staff_memberships (CP2 grants), so the
 * database is the only thing standing in the way. Neither CP2's isolation
 * e2e spec nor the RLS invariant test covers this shape -- the invariant
 * test only asserts RLS is ENABLED, never that a policy is NARROW.
 *
 * These tests connect as raise_app (APP_DATABASE_URL), the unprivileged
 * runtime role. Connecting as the migration superuser would bypass RLS
 * entirely and make every assertion below pass vacuously.
 */
describe('self_membership_lookup policy is read-only', () => {
  let root: PrismaClient;
  let app: PrismaClient;

  const restaurantA = `test-selfpol-a-${randomUUID()}`;
  const restaurantB = `test-selfpol-b-${randomUUID()}`;
  const email = `selfpol-${randomUUID()}@example.test`;
  let userId: string;

  beforeAll(async () => {
    root = createTestPrismaClient();
    await root.$connect();

    for (const [id, name] of [
      [restaurantA, 'Self Policy A'],
      [restaurantB, 'Self Policy B'],
    ] as const) {
      await root.restaurant.create({
        data: { id, name, timezone: 'UTC', address: '1 Test St', phone: '+15555550199', settings: {} },
      });
    }

    const user = await root.user.create({
      data: { email, passwordHash: 'not-a-real-hash', name: 'Self Policy User' },
    });
    userId = user.id;

    // Legitimately a member of A only -- never of B.
    await root.staffMembership.create({
      data: { userId, restaurantId: restaurantA, role: 'foh' },
    });

    app = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.APP_DATABASE_URL }),
    });
    await app.$connect();
  });

  afterAll(async () => {
    await app.$disconnect();
    await root.staffMembership.deleteMany({ where: { userId } });
    await root.user.deleteMany({ where: { email } });
    await root.restaurant.deleteMany({ where: { id: { in: [restaurantA, restaurantB] } } });
    await root.$disconnect();
  });

  it('still lets a staff user read their own membership rows (the feature it exists for)', async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return tx.staffMembership.findMany({ where: { userId } });
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.restaurantId).toBe(restaurantA);
  });

  it('refuses a self-granted membership into a restaurant the user does not belong to', async () => {
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return tx.staffMembership.create({
          data: { userId, restaurantId: restaurantB, role: 'owner' },
        });
      }),
    ).rejects.toThrow();

    // And nothing landed: verified as the superuser, so RLS cannot hide a row.
    const smuggled = await root.staffMembership.findMany({
      where: { userId, restaurantId: restaurantB },
    });
    expect(smuggled).toHaveLength(0);
  });

  it('refuses self-promotion of an existing membership to owner', async () => {
    await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      // No tenant scope is set, so tenant_isolation's USING matches nothing and
      // self_membership_lookup (SELECT-only) contributes no UPDATE permission:
      // the update must touch zero rows rather than escalating the role.
      const result = await tx.staffMembership.updateMany({
        where: { userId, restaurantId: restaurantA },
        data: { role: 'owner' },
      });
      expect(result.count).toBe(0);
    });

    const after = await root.staffMembership.findFirstOrThrow({
      where: { userId, restaurantId: restaurantA },
    });
    expect(after.role).toBe('foh');
  });
});
