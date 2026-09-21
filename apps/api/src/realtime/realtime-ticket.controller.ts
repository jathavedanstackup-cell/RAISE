import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard.js';
import { StaffRestaurantGuard } from '../auth/guards/staff-restaurant.guard.js';
import type { StaffRequest } from '../auth/guards/request.types.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';

/**
 * CP7 — the server-to-server half of the ticket-exchange design in
 * docs/decisions.md. `apps/restaurant` calls this the same way it calls
 * every other authenticated endpoint (staff JWT via apiFetch); the
 * response ticket, not the JWT, is what the browser gets handed.
 */
@Controller('restaurants/:restaurantId/realtime')
@UseGuards(StaffJwtGuard, StaffRestaurantGuard)
export class RealtimeTicketController {
  constructor(private readonly tickets: RealtimeTicketService) {}

  @Post('ticket')
  mint(@Req() request: StaffRequest) {
    return this.tickets.mint(request.staffUserId, request.restaurantId);
  }
}
