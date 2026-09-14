import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

/** The interactive-transaction client passed into forRestaurant/bypassScope callbacks. */
export type ScopedPrisma = Prisma.TransactionClient;

/**
 * Wraps every query for a request in a transaction that first sets the
 * Postgres session variable CP2's RLS policies read (`app.current_restaurant_id`
 * or `app.bypass_rls`). This is the app-level half of the enforcement layer —
 * see the migration in prisma/migrations/*_cp2_staff_customer_auth for the
 * database half, and docs/decisions.md for why both exist together.
 *
 * Pattern is Prisma's own documented approach for RLS multi-tenancy
 * (Client Extensions + set_config inside $transaction).
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

  /**
   * Explicit, narrow escape hatch for operations that are legitimately
   * cross-tenant by nature (seeding, a future platform-admin path). Never
   * call this from normal request handling — it is not gated by any staff
   * membership check.
   */
  bypassScope<T>(work: (tx: ScopedPrisma) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return work(tx);
    });
  }
}
