import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerTokenService } from '../tokens/customer-token.service.js';
import { extractHeaderToken } from './bearer-token.util.js';
import type { CustomerRequest } from './request.types.js';

const CUSTOMER_TOKEN_HEADER = 'x-customer-token';

/**
 * CP5 trust boundary (see docs/decisions.md — this closes the threat
 * model's TM-03 finding from the CP4 review): possession of the intake
 * draft token alone must never be enough to confirm a booking, because
 * it's a pure capability token with no identity binding — if it ever
 * leaks through a channel other than the URL-path leak CP4's IDOR fix
 * already closed (a shared screen, a support message), a different
 * person could confirm on someone else's behalf.
 *
 * This guard requires a SECOND, independent token — a verified customer
 * session from CP2's existing phone-OTP flow (`/auth/customer/otp/*`,
 * unchanged, reused as-is) — carried in its own header rather than
 * `Authorization`, since `IntakeDraftGuard` already owns that header on
 * this same route (see bearer-token.util.ts). Both guards must pass for
 * `POST .../visits/:visitId/confirm` to proceed.
 */
@Injectable()
export class ConfirmCustomerGuard implements CanActivate {
  constructor(private readonly customerTokens: CustomerTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractHeaderToken(request, CUSTOMER_TOKEN_HEADER);
    if (!token) throw new UnauthorizedException('Missing verified customer token');

    try {
      const payload = this.customerTokens.verify(token);
      (request as CustomerRequest).customerId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired customer token');
    }
  }
}
