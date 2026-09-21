import { ConflictException, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AcknowledgeAllergyResponse, FoodOutResponse, KitchenQueueResponse } from '@raise/shared-types';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard.js';
import { StaffRestaurantGuard } from '../auth/guards/staff-restaurant.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { StaffRequest } from '../auth/guards/request.types.js';
import { RestaurantTimezoneService } from '../prisma/restaurant-timezone.service.js';
import { KitchenService } from './kitchen.service.js';

/**
 * CP8 — the kitchen display's surface. Same guard chain CP2/CP3/CP6/CP7
 * established: StaffJwtGuard (401) -> StaffRestaurantGuard (404 on no
 * membership) -> RolesGuard (403 on insufficient role).
 */
@Controller('restaurants/:restaurantId/kitchen')
@UseGuards(StaffJwtGuard, StaffRestaurantGuard, RolesGuard)
export class KitchenDisplayController {
  constructor(
    private readonly kitchen: KitchenService,
    private readonly timezones: RestaurantTimezoneService,
  ) {}

  /** The prep queue: due tickets only, ordered by computed kitchen start, not by order-in time. */
  @Get('queue')
  @Roles('kitchen', 'owner', 'foh')
  async queue(@Req() request: StaffRequest): Promise<KitchenQueueResponse> {
    const [tickets, timezone] = await Promise.all([
      this.kitchen.listQueue(request.restaurantId),
      this.timezones.forRestaurant(request.restaurantId),
    ]);
    return { tickets, timezone };
  }

  /** Records that a human confirmed they saw the allergy flags. Does not change what is displayed. */
  @Post('visits/:visitId/allergy-ack')
  @Roles('kitchen', 'owner')
  async acknowledgeAllergies(
    @Req() request: StaffRequest,
    @Param('visitId') visitId: string,
  ): Promise<AcknowledgeAllergyResponse> {
    const result = await this.kitchen.acknowledgeAllergies(request.restaurantId, visitId, request.staffUserId);
    return {
      visitId,
      acknowledgedAt: result.acknowledgedAt.toISOString(),
      alreadyAcknowledged: result.alreadyAcknowledged,
    };
  }

  @Post('visits/:visitId/food-out')
  @Roles('kitchen', 'owner')
  async foodOut(@Req() request: StaffRequest, @Param('visitId') visitId: string): Promise<FoodOutResponse> {
    const result = await this.kitchen.markFoodOut(request.restaurantId, visitId, request.staffUserId);

    if (!result.served) {
      throw new ConflictException({
        message:
          result.rejection === 'allergy_not_acknowledged'
            ? 'This order has allergy flags. Confirm you have seen them before sending it out.'
            : "This ticket isn't in the pass — prep hasn't been accepted, or it has already moved on.",
        reason: result.rejection,
      });
    }

    return { visitId, alreadyServed: result.alreadyServed, servedAt: result.servedAt?.toISOString() };
  }
}
