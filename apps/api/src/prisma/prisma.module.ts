import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { RestaurantTimezoneService } from './restaurant-timezone.service.js';

@Global()
@Module({
  providers: [PrismaService, TenantPrismaService, RestaurantTimezoneService],
  exports: [PrismaService, TenantPrismaService, RestaurantTimezoneService],
})
export class PrismaModule {}
