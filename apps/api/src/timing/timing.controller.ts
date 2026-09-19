import { ConflictException, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard.js';
import { StaffRestaurantGuard } from '../auth/guards/staff-restaurant.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { StaffRequest } from '../auth/guards/request.types.js';
import { TimingService } from './timing.service.js';

/**
 * CP6 — the kitchen accept-step trust boundary (docs/decisions.md:
 * "Kitchen auto-start vs. staff accept-step", provisional). This is the
 * ONLY route in the codebase that can move a Visit to `kitchen_started`.
 * Same guard chain CP2/CP3 established — StaffJwtGuard (401) ->
 * StaffRestaurantGuard (404 on no membership) -> RolesGuard (403 on
 * insufficient role) — restricted to `kitchen`/`owner`, since accepting a
 * prep prompt isn't a front-of-house action.
 */
@Controller('restaurants/:restaurantId/visits')
@UseGuards(StaffJwtGuard, StaffRestaurantGuard, RolesGuard)
export class KitchenController {
  constructor(private readonly timing: TimingService) {}

  @Post(':visitId/kitchen/accept')
  @Roles('kitchen', 'owner')
  async accept(@Req() request: StaffRequest, @Param('visitId') visitId: string) {
    const result = await this.timing.acceptKitchenStart(request.restaurantId, visitId, request.staffUserId);
    if (!result.accepted) {
      throw new ConflictException({
        message: "This visit isn't ready to start prep — it was never confirmed, or the booking fell through.",
        reason: result.rejection,
      });
    }
    return { alreadyAccepted: result.alreadyAccepted, acceptedAt: result.acceptedAt?.toISOString() };
  }

  /**
   * Manual "recompute now" trigger — also how a confirmed visit gets its
   * first kitchen_start_target/food_out_target, since nothing computes
   * that automatically yet (see docs/decisions.md and TimingService's own
   * doc comment on `recompute`). Any staff role: read-only in effect, it
   * only ever updates the two target columns, never `status`.
   */
  @Post(':visitId/timing/recompute')
  @Roles('kitchen', 'owner', 'foh')
  async recompute(@Req() request: StaffRequest, @Param('visitId') visitId: string) {
    const result = await this.timing.recompute(request.restaurantId, visitId);
    if (!result.applied) {
      throw new ConflictException({
        message: 'Nothing to compute yet — this visit needs a confirmed table, arrival time, and at least one item first.',
        reason: result.rejection,
      });
    }
    return {
      kitchenStartTarget: result.targets!.kitchenStartTarget.toISOString(),
      foodOutTarget: result.targets!.foodOutTarget.toISOString(),
    };
  }
}
