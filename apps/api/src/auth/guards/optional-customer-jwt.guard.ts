import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerTokenService } from '../tokens/customer-token.service.js';
import { extractBearerToken } from './bearer-token.util.js';
import type { CustomerRequest } from './request.types.js';

/**
 * CP4: intake is guest-first and starts before any phone verification
 * (Part 8 Q4 — "you just speak," no login wall before the guest even
 * starts talking; see docs/decisions.md). If a valid customer bearer token
 * IS present, attach customerId so the draft can be linked to a real
 * Customer from the start; if absent or invalid, proceed anonymously
 * rather than blocking the conversation — unlike CustomerJwtGuard, this
 * guard never throws. Linking an anonymous draft to a Customer once the
 * guest does verify is CP5's job (the confirm flow), not CP4's.
 */
@Injectable()
export class OptionalCustomerJwtGuard implements CanActivate {
  constructor(private readonly customerTokens: CustomerTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) return true;

    try {
      const payload = this.customerTokens.verify(token);
      (request as CustomerRequest).customerId = payload.sub;
    } catch {
      // Invalid/expired token: proceed anonymously rather than blocking —
      // this guard's whole point is never gating the conversation on auth.
    }
    return true;
  }
}
