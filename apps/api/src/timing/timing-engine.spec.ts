import { describe, expect, it } from 'vitest';
import { computeTimingTargets, InvalidTimingInputError } from './timing-engine.js';

/**
 * Zero database, zero NestJS module, zero clock -- see timing-engine.ts's
 * own header for why. `npm run test` picks this up like any other
 * `*.spec.ts`, but unlike the CRUD specs under src/prisma, it never opens
 * a Postgres connection.
 */
describe('computeTimingTargets', () => {
  /**
   * The deck's own worked example (docs/production-plan.md, and the
   * scenario CP06-timing-engine.md's "done when" bar is built on): order
   * in 7:52, arrival 8:15, kitchen start 7:58, food out 8:18.
   *
   * The deck gives arrival/kitchen-start/food-out, not the dish's own
   * prep time or the restaurant's buffer -- those are modelling choices,
   * not given facts, so this test states them explicitly rather than
   * hiding them inside "whatever makes the assertion pass":
   *
   *   - prepTimeMinutes = 12 -- not invented for this test. It's the
   *     exact value CP1's seed.ts already assigns to one of its seeded
   *     dishes, and it's the only prep time that reconciles with
   *     avgPrepBufferMinutes = 5 (CP1's seeded restaurant setting,
   *     also not invented here) to land kitchen_start exactly on 7:58:
   *     8:15 - 12min - 5min = 7:58. Both inputs already existed in this
   *     codebase before CP6 touched it.
   *   - expoBufferMinutes = 8 is new (CP6 adds this key to
   *     Restaurant.settings). It's the value that reconciles food_out
   *     with 8:18: 7:58 + 12min + 8min = 8:18. See docs/decisions.md's
   *     CP6 entry and timing-engine.ts's header for why a second,
   *     independent buffer is structurally required here -- reusing
   *     avgPrepBufferMinutes symmetrically on both ends always produces
   *     food_out = arrival_eta exactly (8:15), never the deck's 8:18, no
   *     matter what prep/buffer split is chosen. That's not fixed by
   *     picking different numbers; it's fixed by using a second constant.
   */
  it('reproduces the deck\'s worked example: order 7:52, arrival 8:15, kitchen start 7:58, food out 8:18', () => {
    const arrivalEta = new Date(Date.UTC(2026, 5, 15, 20, 15)); // 8:15 PM, arbitrary non-DST day
    const settings = { avgPrepBufferMinutes: 5, expoBufferMinutes: 8 };

    const { kitchenStartTarget, foodOutTarget } = computeTimingTargets(arrivalEta, [12], settings);

    expect(kitchenStartTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 19, 58))); // 7:58 PM
    expect(foodOutTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 20, 18))); // 8:18 PM
  });

  it('times the whole order off the longest-prep item, not the first or the average', () => {
    const arrivalEta = new Date(Date.UTC(2026, 5, 15, 20, 15));
    const settings = { avgPrepBufferMinutes: 5, expoBufferMinutes: 8 };

    // Same longest item (12) buried among faster ones -- result must be identical to the single-item case above.
    const { kitchenStartTarget, foodOutTarget } = computeTimingTargets(arrivalEta, [3, 12, 8], settings);

    expect(kitchenStartTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 19, 58)));
    expect(foodOutTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 20, 18)));
  });

  it('rejects an order with no items -- there is no prep time to compute from', () => {
    const arrivalEta = new Date(Date.UTC(2026, 5, 15, 20, 15));
    expect(() => computeTimingTargets(arrivalEta, [], { avgPrepBufferMinutes: 5, expoBufferMinutes: 8 })).toThrow(
      InvalidTimingInputError,
    );
  });

  it('rejects a non-positive prep time rather than silently producing a nonsense target', () => {
    const arrivalEta = new Date(Date.UTC(2026, 5, 15, 20, 15));
    const settings = { avgPrepBufferMinutes: 5, expoBufferMinutes: 8 };
    expect(() => computeTimingTargets(arrivalEta, [0], settings)).toThrow(InvalidTimingInputError);
    expect(() => computeTimingTargets(arrivalEta, [-5], settings)).toThrow(InvalidTimingInputError);
  });

  /**
   * DST boundary. US spring-forward 2027 is Sunday, March 14 -- local
   * clocks jump from 2:00 AM straight to 3:00 AM Eastern, so 2:00-2:59 AM
   * never happens that day. Pick an arrival ETA instant that lands just
   * after the jump (3:12 AM EDT) whose kitchen_start_target (17 real
   * minutes earlier) falls BEFORE the jump (1:55 AM EST) -- i.e. the
   * 17-minute gap straddles the transition.
   *
   * A naive implementation that parsed the arrival as a LOCAL time
   * string ("03:12") and subtracted 17 minutes from the digits would
   * produce "02:55" -- a wall-clock time that literally never existed
   * that morning. This engine never does that: every value here is a
   * `Date` (a UTC instant), and `addMinutes` only ever adds milliseconds
   * to an instant, so it can't produce an impossible local time -- it
   * can only produce a correct instant, which is *then* correctly
   * resolved to "1:55 AM EST" (not "2:55 AM" and not an error) by
   * `Intl.DateTimeFormat`, exactly because the formatting step is kept
   * separate from the arithmetic step.
   */
  it('stays correct across a DST spring-forward boundary (US Eastern, 2027-03-14)', () => {
    const arrivalEta = new Date(Date.UTC(2027, 2, 14, 7, 12)); // 07:12 UTC = 3:12 AM EDT (after the jump)
    const settings = { avgPrepBufferMinutes: 5, expoBufferMinutes: 8 };

    const { kitchenStartTarget, foodOutTarget } = computeTimingTargets(arrivalEta, [12], settings);

    // The arithmetic itself: exactly 17 and 20 real minutes apart, always, DST or not.
    expect(arrivalEta.getTime() - kitchenStartTarget.getTime()).toBe(17 * 60_000);
    expect(foodOutTarget.getTime() - kitchenStartTarget.getTime()).toBe(20 * 60_000);

    const format = (date: Date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);

    // kitchen_start_target crossed back over the transition into EST -- correctly "1:55", never the impossible "2:55".
    expect(format(kitchenStartTarget)).toBe('01:55');
    expect(format(arrivalEta)).toBe('03:12');
    expect(format(foodOutTarget)).toBe('03:15');
  });
});
