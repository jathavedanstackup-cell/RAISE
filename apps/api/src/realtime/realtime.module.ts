import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeTicketController } from './realtime-ticket.controller.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { VisitsGateway } from './visits.gateway.js';

@Module({
  imports: [AuthModule],
  controllers: [RealtimeTicketController],
  providers: [RealtimeTicketService, VisitsGateway],
  exports: [RealtimeTicketService],
})
export class RealtimeModule {}
