/** Decoded JWT payload shape common to both staff and customer tokens. */
export interface AuthTokenPayload {
  sub: string; // User.id (staff) or Customer.id (customer)
}

/**
 * CP4 pre-merge fix: a draft-intake capability token, not an identity
 * token — it proves the bearer is the one who started (or was handed)
 * this specific draft Visit, not who they are. Scoped to both ids so a
 * token minted for one visit/restaurant pair can never be replayed
 * against another — see docs/decisions.md and IntakeDraftGuard.
 */
export interface IntakeDraftTokenPayload {
  visitId: string;
  restaurantId: string;
}
