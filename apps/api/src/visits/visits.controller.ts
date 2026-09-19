import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IntakeDraftGuard } from '../auth/guards/intake-draft.guard.js';
import { ConfirmCustomerGuard } from '../auth/guards/confirm-customer.guard.js';
import type { CustomerRequest } from '../auth/guards/request.types.js';
import { VisitsService } from './visits.service.js';

/**
 * CP5 — the explicit confirmation trust boundary (see docs/decisions.md
 * and docs/checkpoints/CP05-confirmation-booking.md). This is the ONLY
 * route in the codebase that can move a Visit to `confirmed`.
 *
 * Requires BOTH guards: `IntakeDraftGuard` (Authorization header — proves
 * the bearer holds this specific draft) AND `ConfirmCustomerGuard`
 * (X-Customer-Token header — proves the bearer is a phone-verified
 * customer via CP2's existing OTP flow, reused unchanged). Neither token
 * alone is sufficient — see docs/decisions.md for why the draft token by
 * itself was never meant to authorize a booking.
 */
@Controller('restaurants/:restaurantId/visits')
@UseGuards(IntakeDraftGuard, ConfirmCustomerGuard)
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post(':visitId/confirm')
  confirm(@Param('restaurantId') restaurantId: string, @Param('visitId') visitId: string, @Req() request: CustomerRequest) {
    return this.visits.confirm(restaurantId, visitId, request.customerId);
  }
}
