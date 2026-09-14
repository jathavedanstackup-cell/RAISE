import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard.js';
import { StaffRestaurantGuard } from '../auth/guards/staff-restaurant.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { StaffRequest } from '../auth/guards/request.types.js';

/**
 * Minimal restaurant-scoped resource for CP2: just enough surface (list,
 * get-by-id, create, update) to prove the guard/RLS mechanism generically,
 * per this checkpoint's "direct-object-reference attempts, not just list
 * endpoints" requirement. CP3 owns the full menu management CRUD + admin
 * UI and should build on this same guard stack rather than duplicate it.
 *
 * Guard order matters: StaffJwtGuard (401 on missing/invalid/wrong-audience
 * token) -> StaffRestaurantGuard (404 on no membership — see its own
 * comment on why 404, not 403) -> RolesGuard (403 on insufficient role).
 */
@Controller('restaurants/:restaurantId/menu-items')
@UseGuards(StaffJwtGuard, StaffRestaurantGuard, RolesGuard)
export class MenuItemsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  list(@Req() request: StaffRequest) {
    return this.tenantPrisma.forRestaurant(request.restaurantId, (tx) =>
      tx.menuItem.findMany({ where: { restaurantId: request.restaurantId }, orderBy: { name: 'asc' } }),
    );
  }

  @Get(':id')
  async get(@Req() request: StaffRequest, @Param('id') id: string) {
    const item = await this.tenantPrisma.forRestaurant(request.restaurantId, (tx) =>
      tx.menuItem.findFirst({ where: { id, restaurantId: request.restaurantId } }),
    );
    // Not found covers both "no such item" and "item belongs to another
    // restaurant" — see StaffRestaurantGuard's comment on why 404 over 403.
    if (!item) throw new NotFoundException();
    return item;
  }

  @Post()
  @Roles('owner')
  create(@Req() request: StaffRequest, @Body() body: Record<string, unknown>) {
    const { name, price, prepTimeMinutes, category } = body;
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      (typeof price !== 'string' && typeof price !== 'number') ||
      typeof prepTimeMinutes !== 'number' ||
      typeof category !== 'string' ||
      category.length === 0
    ) {
      // Reject malformed input rather than silently defaulting it (e.g. a
      // missing name becoming ""): CP3 owns full validation for this
      // resource, but this demo surface shouldn't create nonsense rows.
      throw new BadRequestException('name, price, prepTimeMinutes, and category are required');
    }
    const allergens = Array.isArray(body.allergens) ? (body.allergens as string[]) : [];
    const modifiableOptions = Array.isArray(body.modifiableOptions) ? (body.modifiableOptions as string[]) : [];

    return this.tenantPrisma.forRestaurant(request.restaurantId, (tx) =>
      tx.menuItem.create({
        data: {
          restaurantId: request.restaurantId,
          name,
          price: String(price),
          prepTimeMinutes,
          allergens,
          modifiableOptions,
          category,
        },
      }),
    );
  }

  @Patch(':id')
  @Roles('owner')
  async update(
    @Req() request: StaffRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    // updateMany + where.restaurantId (not update-by-id alone) is the
    // direct-object-reference guard on the write path: if `id` belongs to
    // another restaurant, this matches zero rows instead of touching it —
    // even before RLS's own WITH CHECK would refuse it at the DB level.
    const result = await this.tenantPrisma.forRestaurant(request.restaurantId, (tx) =>
      tx.menuItem.updateMany({
        where: { id, restaurantId: request.restaurantId },
        data: {
          ...(typeof body.name === 'string' ? { name: body.name } : {}),
          ...(typeof body.available === 'boolean' ? { available: body.available } : {}),
        },
      }),
    );
    if (result.count === 0) throw new NotFoundException();
    return { ok: true };
  }
}
