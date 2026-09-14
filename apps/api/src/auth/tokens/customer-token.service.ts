import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { requireEnv } from '../env.util.js';
import type { AuthTokenPayload } from './token.types.js';

const AUDIENCE = 'customer';
const EXPIRES_IN = '30d'; // guest-first: long-lived so a customer isn't re-OTP'd every visit

function secret(): string {
  return requireEnv('JWT_CUSTOMER_SECRET');
}

@Injectable()
export class CustomerTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(customerId: string): string {
    return this.jwt.sign({ sub: customerId }, { secret: secret(), audience: AUDIENCE, expiresIn: EXPIRES_IN });
  }

  /** Throws if the token is missing, expired, malformed, or not a customer token. */
  verify(token: string): AuthTokenPayload {
    return this.jwt.verify<AuthTokenPayload>(token, { secret: secret(), audience: AUDIENCE });
  }
}
