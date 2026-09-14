import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerTokenService } from '../tokens/customer-token.service.js';
import { extractBearerToken } from './staff-jwt.guard.js';
import type { CustomerRequest } from './request.types.js';

@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(private readonly customerTokens: CustomerTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const payload = this.customerTokens.verify(token);
      (request as CustomerRequest).customerId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired customer token');
    }
  }
}
