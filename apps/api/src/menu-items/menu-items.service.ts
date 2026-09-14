import { Injectable, NotFoundException } from '@nestjs/common';
import type { MenuItemCreateInput, MenuItemUpdateInput } from '@raise/shared-types';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/**
 * CP3's real menu-item CRUD, replacing CP2's demo controller (which was
 * explicitly scoped as "just enough surface to prove the guard/RLS
 * mechanism" — see docs/decisions.md). Same guard chain, same
 * TenantPrismaService usage, same 404-for-cross-tenant discipline; this
 * class only adds the actual business behavior CP3 owns.
 *
 * Every read goes straight through TenantPrismaService to Postgres — no
 * cache, no denormalized copy, no build-time snapshot anywhere in this
 * class. That's not a performance choice being deferred; it's the
 * mechanism that makes CP3's own "done when" bar true: an owner disabling
 * a dish is reflected in the very next query, because there is no other
 * copy of this data for a query to have gone stale against. See
 * menu-items.e2e-spec.ts for the test that proves this, and Part 5's
 * zero-hallucination-tolerance requirement for why it matters.
 */
@Injectable()
export class MenuItemsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  list(restaurantId: string, options: { availableOnly?: boolean } = {}) {
    return this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.menuItem.findMany({
        where: { restaurantId, ...(options.availableOnly ? { available: true } : {}) },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async get(restaurantId: string, id: string) {
    const item = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.menuItem.findFirst({ where: { id, restaurantId } }),
    );
    // Not found covers both "no such item" and "item belongs to another
    // restaurant" — see StaffRestaurantGuard's comment on why 404 over 403.
    if (!item) throw new NotFoundException();
    return item;
  }

  create(restaurantId: string, input: MenuItemCreateInput) {
    return this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.menuItem.create({
        data: {
          restaurantId,
          name: input.name,
          description: input.description,
          price: input.price,
          prepTimeMinutes: input.prepTimeMinutes,
          category: input.category,
          allergens: input.allergens,
          modifiableOptions: input.modifiableOptions,
          available: input.available,
        },
      }),
    );
  }

  async update(restaurantId: string, id: string, input: MenuItemUpdateInput) {
    // updateMany + where.restaurantId (not update-by-id alone) is the
    // direct-object-reference guard on the write path: if `id` belongs to
    // another restaurant, this matches zero rows instead of touching it —
    // even before RLS's own WITH CHECK would refuse it at the DB level.
    const result = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.menuItem.updateMany({
        where: { id, restaurantId },
        data: input,
      }),
    );
    if (result.count === 0) throw new NotFoundException();
    return this.get(restaurantId, id);
  }
}
