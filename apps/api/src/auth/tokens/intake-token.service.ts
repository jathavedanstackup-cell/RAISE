import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { requireEnv } from '../env.util.js';
import { getDraftTokenTtlSeconds } from '../../intake/draft-policy.js';
import type { IntakeDraftTokenPayload } from './token.types.js';

const AUDIENCE = 'intake-draft';

function secret(): string {
  return requireEnv('JWT_INTAKE_SECRET');
}

/**
 * CP4 pre-merge security fix: closes an IDOR where `visitId` alone (a
 * uuid(7) travelling in a URL path — server logs, proxy logs, browser
 * history, Referer headers) was acting as a bearer credential. A separate
 * signing secret (JWT_INTAKE_SECRET), distinct from JWT_STAFF_SECRET and
 * JWT_CUSTOMER_SECRET, following the same "separate secret per audience"
 * reasoning CP2 established — a leak of one can't forge the others. See
 * docs/decisions.md.
 *
 * This is a capability token, not an identity token: it proves "the
 * bearer is who started (or was handed) this specific draft," not who
 * they are — OptionalCustomerJwtGuard's customerId linkage is orthogonal
 * and untouched by this fix.
 *
 * CP4 follow-up (see docs/decisions.md): the token's own `exp` is
 * `getDraftTokenTtlMs()` — deliberately LONGER than
 * `Visit.draftExpiresAt`'s business inactivity window
 * (`getDraftInactivityWindowMs()`), not the same number. The first
 * version of this fix reused the business window for both, which meant a
 * guest returning after 15 minutes of silence had their token expire at
 * the exact same moment the recap-and-reconfirm flow was supposed to
 * catch them — IntakeDraftGuard rejected them with a 404 before
 * IntakeService's own staleness logic ever ran. Reissued on every turn
 * (mirroring Visit.draftExpiresAt's own refresh) so an actively-used
 * conversation never approaches either ceiling.
 */
@Injectable()
export class IntakeTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(visitId: string, restaurantId: string): string {
    return this.jwt.sign(
      { visitId, restaurantId },
      { secret: secret(), audience: AUDIENCE, expiresIn: `${getDraftTokenTtlSeconds()}s` },
    );
  }

  /** Throws if the token is missing, expired, malformed, or not an intake-draft token. */
  verify(token: string): IntakeDraftTokenPayload {
    return this.jwt.verify<IntakeDraftTokenPayload>(token, { secret: secret(), audience: AUDIENCE });
  }
}
