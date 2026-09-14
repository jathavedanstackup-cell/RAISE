import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MenuItemsController } from './menu-items.controller.js';
import { MenuItemsService } from './menu-items.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MenuItemsController],
  providers: [MenuItemsService],
})
export class MenuItemsModule {}
