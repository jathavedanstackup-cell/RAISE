import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

/** The interactive-transaction client passed into forRestaurant's callback. */
export type ScopedPrisma = Prisma.TransactionClient;

/**
 * Wraps every query for a request in a transaction that first sets the
 * Postgres session variable CP2's RLS policies read
 * (`app.current_restaurant_id`). This is the app-level half of the
 * enforcement layer — see the migration in
 * prisma/migrations/*_cp2_staff_customer_auth for the database half, and
 * docs/decisions.md for why both exist together.
 *
 * Pattern is Prisma's own documented approach for RLS multi-tenancy
 * (Client Extensions + set_config inside $transaction).
 *
 * There is deliberately no bypass/escape-hatch method here. An earlier
 * version had one (`bypassScope`, backed by an `app.bypass_rls` policy on
 * every table) — it was never called (seeding already runs as the
 * superuser DATABASE_URL role, which bypasses RLS structurally) and was
 * removed as a pre-merge security fix: Postgres ORs permissive policies
 * together, so that one policy meant any code path able to set
 * `app.bypass_rls` disabled tenant isolation on every table, for reads and
 * writes, everywhere. If a genuinely cross-tenant platform-admin path is
 * needed later (CP11+), it gets its own narrowly-scoped mechanism then,
 * with a test pinning its blast radius.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Scope every query in `work` to a single restaurant. */
  forRestaurant<T>(restaurantId: string, work: (tx: ScopedPrisma) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_restaurant_id', ${restaurantId}, true)`;
      return work(tx);
    });
  }
}
