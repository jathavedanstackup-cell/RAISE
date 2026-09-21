import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TimingModule } from '../timing/timing.module.js';
import { KitchenDisplayController } from './kitchen.controller.js';
import { KitchenService } from './kitchen.service.js';

/** CP8 — kitchen display. Imports TimingModule for the CLOCK provider CP6 established. */
@Module({
  imports: [AuthModule, TimingModule],
  controllers: [KitchenDisplayController],
  providers: [KitchenService],
  exports: [KitchenService],
})
export class KitchenModule {}
