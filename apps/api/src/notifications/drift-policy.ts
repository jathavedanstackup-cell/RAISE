/**
 * CP9 — "significantly" for the drift alert, made a real number. Same
 * override-for-tests shape as CP4's draft-policy.ts.
 *
 * 10 minutes: twice `avgPrepBufferMinutes`'s seeded default (5). A drift
 * smaller than the buffer is already absorbed by the safety margin
 * already built into kitchen_start_target -- that's what the buffer is
 * for. A drift at or beyond 2x the buffer materially eats into or
 * eliminates that margin, which is exactly when staff need to know
 * rather than have the timing engine silently absorb it. See
 * docs/decisions.md's CP9 entry.
 */
const DEFAULT_ETA_DRIFT_ALERT_THRESHOLD_MINUTES = 10;

function readMinutesOverride(envVar: string, defaultMinutes: number): number {
  const raw = process.env[envVar];
  if (!raw) return defaultMinutes;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMinutes;
}

export function getEtaDriftAlertThresholdMinutes(): number {
  return readMinutesOverride('ETA_DRIFT_ALERT_THRESHOLD_MINUTES_OVERRIDE', DEFAULT_ETA_DRIFT_ALERT_THRESHOLD_MINUTES);
}

/** Pure: whether a kitchen_start_target shift of this magnitude clears the alert bar. Zero DB, unit-tested directly. */
export function isSignificantDrift(driftMs: number): boolean {
  const thresholdMs = getEtaDriftAlertThresholdMinutes() * 60_000;
  return Math.abs(driftMs) >= thresholdMs;
}
