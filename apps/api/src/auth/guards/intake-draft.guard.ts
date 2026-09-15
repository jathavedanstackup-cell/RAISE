import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { IntakeTokenService } from '../tokens/intake-token.service.js';
import { extractBearerToken } from './bearer-token.util.js';

/**
 * CP4 pre-merge security fix (IDOR): before this guard existed, the two
 * `:visitId` intake routes authorized on nothing but `restaurantId` — any
 * holder of a `visitId` (which travels in a URL path: server logs, proxy
 * logs, browser history, Referer headers) could read another guest's full
 * conversation transcript and mutate their draft order. `uuid(7)` entropy
 * makes the id unguessable, not unleakable — a bearer credential needs to
 * not appear in those places at all, which is exactly what a
 * header-carried token gives us that a path segment never can.
 *
 * Requires a signed `intake-draft` token (IntakeTokenService) whose
 * `visitId`/`restaurantId` claims both match the route params — a token
 * minted for one draft can't be replayed against another, even at the
 * same restaurant. Every failure mode (missing token, bad signature,
 * wrong audience, expired, or a claim mismatch) 404s identically, same as
 * StaffRestaurantGuard's own "404, not 403" reasoning: a 403 would
 * confirm the visit exists, which is itself the cross-tenant/cross-guest
 * information leak this guard exists to close.
 */
@Injectable()
export class IntakeDraftGuard implements CanActivate {
  constructor(private readonly intakeTokens: IntakeTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new NotFoundException();

    let payload;
    try {
      payload = this.intakeTokens.verify(token);
    } catch {
      throw new NotFoundException();
    }

    const { restaurantId, visitId } = request.params;
    if (payload.restaurantId !== restaurantId || payload.visitId !== visitId) {
      throw new NotFoundException();
    }
    return true;
  }
}
