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
  // CLOCK is exported so later checkpoints (CP8's kitchen display) inject the
  // same clock instance rather than each module providing its own -- one clock
  // per process is what makes time-travel in tests actually control everything.
  exports: [TimingService, CLOCK],
})
export class TimingModule {}
