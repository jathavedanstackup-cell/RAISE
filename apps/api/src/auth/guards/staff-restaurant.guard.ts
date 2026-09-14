import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';
import type { StaffRequest } from './request.types.js';

/**
 * Must run after StaffJwtGuard. Reads the `:restaurantId` route param and
 * checks the authenticated staff user actually has a membership there.
 *
 * Returns 404, not 403, when the membership doesn't exist — whether that's
 * because the restaurant doesn't exist, or because it exists but belongs to
 * someone else. A 403 would confirm the record exists, which is itself a
 * cross-tenant information leak (per this checkpoint's explicit
 * instruction and docs/decisions.md).
 *
 * The membership lookup itself goes through TenantPrismaService.forRestaurant,
 * so it's covered by CP2's RLS policies too — this check isn't the only
 * thing standing between a request and another tenant's staff_memberships row.
 */
@Injectable()
export class StaffRestaurantGuard implements CanActivate {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const restaurantId = request.params.restaurantId;
    if (typeof restaurantId !== 'string' || restaurantId.length === 0) throw new NotFoundException();

    const membership = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.staffMembership.findUnique({
        where: { userId_restaurantId: { userId: request.staffUserId, restaurantId } },
      }),
    );

    if (!membership) throw new NotFoundException();

    request.restaurantId = restaurantId;
    request.staffRole = membership.role;
    return true;
  }
}
