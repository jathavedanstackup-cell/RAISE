import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MenuItemsController } from './menu-items.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [MenuItemsController],
})
export class RestaurantsModule {}
