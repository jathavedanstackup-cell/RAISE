import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { KitchenController } from './timing.controller.js';
import { TimingService } from './timing.service.js';
import { CLOCK, SystemClock } from './clock.js';

/**
 * Imports AuthModule for the staff guard chain rather than re-declaring
 * StaffJwtGuard/StaffRestaurantGuard/RolesGuard as its own providers —
 * MenuItemsModule's established pattern. (VisitsModule, CP5, duplicated
 * IntakeTokenService/CustomerTokenService instead; harmless since both
 * are stateless, but this is the cleaner precedent to follow going
 * forward — noted in docs/decisions.md.)
 */
@Module({
  imports: [AuthModule],
  controllers: [KitchenController],
  providers: [TimingService, { provide: CLOCK, useClass: SystemClock }],
  exports: [TimingService],
})
export class TimingModule {}
