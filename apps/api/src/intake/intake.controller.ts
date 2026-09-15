import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { intakeTurnRequestSchema, type IntakeTurnRequest } from '@raise/shared-types';
import { OptionalCustomerJwtGuard } from '../auth/guards/optional-customer-jwt.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { CustomerRequest } from '../auth/guards/request.types.js';
import { IntakeService } from './intake.service.js';

/**
 * Guest-first, on purpose (Part 8 Q4 — see docs/decisions.md): no hard auth
 * guard here. OptionalCustomerJwtGuard attaches a customerId when a valid
 * customer token is already present, but never blocks the conversation
 * from starting without one. Nothing PII-bearing is required before the
 * guest starts talking.
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
  getState(@Param('restaurantId') restaurantId: string, @Param('visitId') visitId: string) {
    return this.intake.getState(restaurantId, visitId);
  }

  @Post(':visitId/turn')
  processTurn(
    @Param('restaurantId') restaurantId: string,
    @Param('visitId') visitId: string,
    @Body(new ZodValidationPipe(intakeTurnRequestSchema)) body: IntakeTurnRequest,
  ) {
    return this.intake.processTurn(restaurantId, visitId, body);
  }
}
