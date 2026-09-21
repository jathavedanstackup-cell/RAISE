import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from './tenant-prisma.service.js';

/**
 * CP10 — the one place `Restaurant.timezone` is read.
 *
 * That column has existed since CP1 and, until this checkpoint, was
 * written by the seed and read by absolutely nothing: the staff screens
 * formatted times in the browser's zone and the booking SMS formatted
 * them in UTC. Global and cheap so that no surface has a reason to skip
 * it and fall back to a local default again.
 *
 * Cached per restaurant for the process lifetime. A restaurant's
 * timezone changes approximately never, and every rendered time on
 * every screen would otherwise cost a query.
 */
@Injectable()
export class RestaurantTimezoneService {
  private readonly cache = new Map<string, string>();

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async forRestaurant(restaurantId: string): Promise<string> {
    const cached = this.cache.get(restaurantId);
    if (cached) return cached;

    const restaurant = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.restaurant.findFirst({ where: { id: restaurantId }, select: { timezone: true } }),
    );
    if (!restaurant) throw new NotFoundException();

    this.cache.set(restaurantId, restaurant.timezone);
    return restaurant.timezone;
  }
}
