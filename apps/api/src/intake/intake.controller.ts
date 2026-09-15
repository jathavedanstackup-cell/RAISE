import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { intakeTurnRequestSchema, type IntakeTurnRequest } from '@raise/shared-types';
import { OptionalCustomerJwtGuard } from '../auth/guards/optional-customer-jwt.guard.js';
import { IntakeDraftGuard } from '../auth/guards/intake-draft.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { CustomerRequest } from '../auth/guards/request.types.js';
import { IntakeService } from './intake.service.js';

/**
 * Guest-first, on purpose (Part 8 Q4 — see docs/decisions.md): no hard auth
 * guard on `start`. OptionalCustomerJwtGuard (class-level, applies to every
 * route here) attaches a customerId when a valid customer token is already
 * present, but never blocks the conversation from starting without one.
 * Nothing PII-bearing is required before the guest starts talking.
 *
 * The two `:visitId` routes additionally require IntakeDraftGuard — a
 * CP4 pre-merge fix (see docs/decisions.md): `visitId` alone is not a
 * credential, no matter how unguessable, because it travels in a URL path
 * (server/proxy logs, browser history, Referer headers). Every response
 * from `start`/`turn` returns a fresh `draftToken`; the caller must send
 * it back as `Authorization: Bearer <token>` on both of these routes.
 */
@Controller('restaurants/:restaurantId/intake')
@UseGuards(OptionalCustomerJwtGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('start')
  start(@Param('restaurantId') restaurantId: string, @Req() request: Partial<CustomerRequest>) {
    return this.intake.start(restaurantId, request.customerId ?? null);
  }

  @Get(':visitId')
  @UseGuards(IntakeDraftGuard)
  getState(@Param('restaurantId') restaurantId: string, @Param('visitId') visitId: string) {
    return this.intake.getState(restaurantId, visitId);
  }

  @Post(':visitId/turn')
  @UseGuards(IntakeDraftGuard)
  processTurn(
    @Param('restaurantId') restaurantId: string,
    @Param('visitId') visitId: string,
    @Body(new ZodValidationPipe(intakeTurnRequestSchema)) body: IntakeTurnRequest,
  ) {
    return this.intake.processTurn(restaurantId, visitId, body);
  }
}
