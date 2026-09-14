import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient } from './test-fixtures.js';

/**
 * `ALTER DEFAULT PRIVILEGES` (in the CP2 migration) auto-grants raise_app
 * DML on every table a future migration adds — but ENABLE/FORCE ROW LEVEL
 * SECURITY stays manual and per-table. Left unchecked, the default for
 * every tenant table CP3-CP13 adds is "raise_app can read/write it,
 * completely unprotected" — a rule a future migration author has to
 * remember, which is exactly the kind of enforcement CP2's own security
 * review said not to rely on. This test turns it into something enforced:
 * it fails loudly the day a table with a restaurant_id column exists
 * without Row Level Security turned on.
 */
describe('RLS invariant', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('every table with a restaurant_id column has Row Level Security enabled', async () => {
    const unprotected = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT DISTINCT col.table_name
      FROM information_schema.columns col
      JOIN pg_catalog.pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = col.table_schema
      WHERE col.table_schema = 'public'
        AND col.column_name = 'restaurant_id'
        AND c.relrowsecurity = false
    `;

    if (unprotected.length > 0) {
      const names = unprotected.map((row) => row.table_name).join(', ');
      throw new Error(
        `Table(s) with a restaurant_id column but no Row Level Security: ${names}. ` +
          'A new tenant-scoped table needs its own ENABLE/FORCE ROW LEVEL SECURITY ' +
          'and tenant_isolation policy — see the CP2 migration for the pattern.',
      );
    }

    expect(unprotected).toHaveLength(0);
  });
});
