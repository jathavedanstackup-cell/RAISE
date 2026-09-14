import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { StaffTokenService } from '../tokens/staff-token.service.js';
import { extractBearerToken } from './bearer-token.util.js';
import type { StaffRequest } from './request.types.js';

/**
 * Verifies the Authorization: Bearer token as a staff-audience JWT. A
 * missing token, an expired/malformed one, or a customer-audience token
 * (wrong `aud`, and signed with a different secret entirely — see
 * StaffTokenService) all fail here with 401, before any restaurant/role
 * check runs.
 */
@Injectable()
export class StaffJwtGuard implements CanActivate {
  constructor(private readonly staffTokens: StaffTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const payload = this.staffTokens.verify(token);
      (request as StaffRequest).staffUserId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired staff token');
    }
  }
}
