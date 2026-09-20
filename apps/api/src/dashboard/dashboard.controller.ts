import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { DashboardListResponse, DashboardTablesResponse, ReassignTableRequest } from '@raise/shared-types';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard.js';
import { StaffRestaurantGuard } from '../auth/guards/staff-restaurant.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { StaffRequest } from '../auth/guards/request.types.js';
import { z } from 'zod';
import { DashboardService } from './dashboard.service.js';
import { TableReassignmentService } from './table-reassignment.service.js';

const reassignTableSchema = z.object({ newTableId: z.string().min(1) });

/** Same guard chain CP2/CP3/CP6 established: StaffJwtGuard -> StaffRestaurantGuard -> RolesGuard. */
@Controller('restaurants/:restaurantId/dashboard')
@UseGuards(StaffJwtGuard, StaffRestaurantGuard, RolesGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reassignment: TableReassignmentService,
  ) {}

  @Get('visits')
  async listVisits(@Req() request: StaffRequest): Promise<DashboardListResponse> {
    const visits = await this.dashboard.listInboundVisits(request.restaurantId);
    return { visits };
  }

  @Get('tables')
  async listTables(@Req() request: StaffRequest): Promise<DashboardTablesResponse> {
    const tables = await this.dashboard.listTables(request.restaurantId);
    return { tables };
  }

  @Post('visits/:visitId/reassign-table')
  @Roles('foh', 'owner')
  reassignTable(
    @Req() request: StaffRequest,
    @Param('visitId') visitId: string,
    @Body(new ZodValidationPipe(reassignTableSchema)) body: ReassignTableRequest,
  ) {
    return this.reassignment.reassign(request.restaurantId, visitId, body.newTableId, request.staffUserId);
  }
}
