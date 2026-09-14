import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokenPayload } from './token.types.js';

const AUDIENCE = 'staff';
const EXPIRES_IN = '12h';

function secret(): string {
  const value = process.env.JWT_STAFF_SECRET;
  if (!value) throw new Error('JWT_STAFF_SECRET is required');
  return value;
}

/**
 * Staff and customer tokens deliberately use separate signing secrets (not
 * just a shared secret + an `aud` claim each checks) so that a leak of one
 * secret cannot forge tokens for the other audience. See docs/decisions.md
 * ("two isolation axes").
 */
@Injectable()
export class StaffTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(userId: string): string {
    return this.jwt.sign({ sub: userId }, { secret: secret(), audience: AUDIENCE, expiresIn: EXPIRES_IN });
  }

  /** Throws if the token is missing, expired, malformed, or not a staff token. */
  verify(token: string): AuthTokenPayload {
    return this.jwt.verify<AuthTokenPayload>(token, { secret: secret(), audience: AUDIENCE });
  }
}
