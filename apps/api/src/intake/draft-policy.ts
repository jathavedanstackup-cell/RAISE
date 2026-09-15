/**
 * Two deliberately DIFFERENT windows — see docs/decisions.md's CP4
 * follow-up entry for why. Before this file, IntakeService and
 * IntakeTokenService shared a single constant, which made
 * IntakeDraftGuard reject a returning guest's token at the exact moment
 * the business logic wanted to show them a recap-and-reconfirm message —
 * the two concerns need different lifetimes:
 *
 * - `getDraftInactivityWindowMs()` — how long a draft can sit silent
 *   before IntakeService treats it as possibly abandoned and asks the
 *   guest to reconfirm (Part 8 Q3). A UX/business signal, not a security
 *   boundary.
 * - `getDraftTokenTtlMs()` — how long the capability token that proves
 *   "the bearer owns this draft" stays cryptographically valid.
 *   Deliberately longer than the inactivity window, so a guest returning
 *   within that grace period is authenticated successfully and reaches
 *   the recap flow instead of a 404. It still has to end somewhere — an
 *   unboundedly long-lived token is worse hygiene even for data that
 *   itself persists — so it is not infinite, just longer than the
 *   business window it used to be wrongly tied to.
 *
 * Read fresh on every call (not cached at module load) via optional
 * `*_OVERRIDE` env vars, test-only, same convention as this repo's other
 * dev/test levers (`OTP_DEV_FIXED_CODE`, `ASR_PROVIDER=dev`, ...) — this
 * lets a test exercise real elapsed time against short, real windows
 * instead of mocking the system clock or faking a DB column. These
 * overrides must never be set outside local dev/CI.
 */
function readMsOverride(envVar: string, defaultMs: number): number {
  const raw = process.env[envVar];
  if (!raw) return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

const DEFAULT_DRAFT_INACTIVITY_WINDOW_MS = 15 * 60 * 1000;
/** 2 hours — a deliberately long grace period past the 15-minute business window, not a second business-meaningful number. See docs/decisions.md. */
const DEFAULT_DRAFT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export function getDraftInactivityWindowMs(): number {
  return readMsOverride('DRAFT_INACTIVITY_WINDOW_MS_OVERRIDE', DEFAULT_DRAFT_INACTIVITY_WINDOW_MS);
}

export function getDraftTokenTtlMs(): number {
  return readMsOverride('DRAFT_TOKEN_TTL_MS_OVERRIDE', DEFAULT_DRAFT_TOKEN_TTL_MS);
}

export function getDraftTokenTtlSeconds(): number {
  return getDraftTokenTtlMs() / 1000;
}
