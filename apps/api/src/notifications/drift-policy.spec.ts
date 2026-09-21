import { afterEach, describe, expect, it } from 'vitest';
import { getEtaDriftAlertThresholdMinutes, isSignificantDrift } from './drift-policy.js';

/** Zero database, zero NestJS module -- same shape as timing-engine.spec.ts (CP6). */
describe('drift-policy', () => {
  afterEach(() => {
    delete process.env.ETA_DRIFT_ALERT_THRESHOLD_MINUTES_OVERRIDE;
  });

  it('defaults to a 10-minute threshold', () => {
    expect(getEtaDriftAlertThresholdMinutes()).toBe(10);
  });

  it('is not significant just under the threshold', () => {
    expect(isSignificantDrift(9 * 60_000)).toBe(false);
  });

  it('is significant at exactly the threshold', () => {
    expect(isSignificantDrift(10 * 60_000)).toBe(true);
  });

  it('treats an ETA moving earlier the same as moving later (magnitude, not direction)', () => {
    expect(isSignificantDrift(-15 * 60_000)).toBe(true);
    expect(isSignificantDrift(-5 * 60_000)).toBe(false);
  });

  it('respects a test override', () => {
    process.env.ETA_DRIFT_ALERT_THRESHOLD_MINUTES_OVERRIDE = '2';
    expect(getEtaDriftAlertThresholdMinutes()).toBe(2);
    expect(isSignificantDrift(3 * 60_000)).toBe(true);
  });

  it('falls back to the default on a garbage override rather than silently disabling the alert', () => {
    process.env.ETA_DRIFT_ALERT_THRESHOLD_MINUTES_OVERRIDE = 'not-a-number';
    expect(getEtaDriftAlertThresholdMinutes()).toBe(10);
  });
});
