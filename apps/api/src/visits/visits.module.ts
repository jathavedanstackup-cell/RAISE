import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';
import { IntakeDraftGuard } from '../auth/guards/intake-draft.guard.js';
import { ConfirmCustomerGuard } from '../auth/guards/confirm-customer.guard.js';
import { IntakeTokenService } from '../auth/tokens/intake-token.service.js';
import { CustomerTokenService } from '../auth/tokens/customer-token.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [VisitsController],
  providers: [VisitsService, IntakeDraftGuard, ConfirmCustomerGuard, IntakeTokenService, CustomerTokenService],
})
export class VisitsModule {}
