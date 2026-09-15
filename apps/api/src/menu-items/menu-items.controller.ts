import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  menuItemCreateSchema,
  menuItemUpdateSchema,
  type MenuItemCreateInput,
  type MenuItemUpdateInput,
} from '@raise/shared-types';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard.js';
import { StaffRestaurantGuard } from '../auth/guards/staff-restaurant.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { StaffRequest } from '../auth/guards/request.types.js';
import { MenuItemsService } from './menu-items.service.js';

/**
 * Real menu management API (CP3), replacing CP2's demo controller.
 * Deliberately the same route shape and guard chain CP2 proved out:
 * StaffJwtGuard (401 on missing/invalid/wrong-audience token) ->
 * StaffRestaurantGuard (404 on no membership) -> RolesGuard (403 on
 * insufficient role). Read access (list/get) is open to any staff role at
 * this restaurant; mutation (create/update, which covers "disable" via
 * `available: false`) is owner-only per the checkpoint.
 */
@Controller('restaurants/:restaurantId/menu-items')
@UseGuards(StaffJwtGuard, StaffRestaurantGuard, RolesGuard)
export class MenuItemsController {
  constructor(private readonly menuItems: MenuItemsService) {}

  @Get()
  list(@Req() request: StaffRequest, @Query('available') available?: string) {
    return this.menuItems.list(request.restaurantId, { availableOnly: available === 'true' });
  }

  @Get(':id')
  get(@Req() request: StaffRequest, @Param('id') id: string) {
    return this.menuItems.get(request.restaurantId, id);
  }

  @Post()
  @Roles('owner')
  create(@Req() request: StaffRequest, @Body(new ZodValidationPipe(menuItemCreateSchema)) body: MenuItemCreateInput) {
    return this.menuItems.create(request.restaurantId, body);
  }

  @Patch(':id')
  @Roles('owner')
  update(
    @Req() request: StaffRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(menuItemUpdateSchema)) body: MenuItemUpdateInput,
  ) {
    return this.menuItems.update(request.restaurantId, id, body);
  }
}
