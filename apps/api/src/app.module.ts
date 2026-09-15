import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MenuItemsModule } from './menu-items/menu-items.module.js';

@Module({
  imports: [PrismaModule, AuthModule, MenuItemsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
