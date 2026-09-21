import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { TableReassignmentService } from './table-reassignment.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, TableReassignmentService],
})
export class DashboardModule {}
