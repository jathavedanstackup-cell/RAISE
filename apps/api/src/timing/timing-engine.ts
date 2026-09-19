/**
 * CP6 — the timing engine's core calculation. Deliberately pure: no
 * Prisma, no NestJS DI, no `Date.now()`, nothing that needs a database or
 * a clock to test. Every input is a plain value; every output is
 * deterministic from those inputs. See timing-engine.spec.ts, which
 * exercises this with zero database.
 *
 * Formula (kitchen_start_target) is the one production-plan.md Part 3
 * already specifies literally: `arrival_eta - max(prep_time_minutes) -
 * buffer`. `buffer` is `Restaurant.settings.avgPrepBufferMinutes`, a
 * field CP1 seeded (`5`) specifically so CP6 would have it ready.
 *
 * `food_out_target` has no formula given anywhere in the docs -- CP6 has
 * to define one. See docs/decisions.md's CP6 entry for the full
 * derivation, but the short version: a single buffer reused symmetrically
 * on both ends (`kitchen_start = arrival - prep - buffer`, `food_out =
 * kitchen_start + prep + buffer`) algebraically always collapses to
 * `food_out = arrival_eta` exactly -- it can never reproduce the deck's
 * worked example, where food_out (8:18) is 3 minutes AFTER arrival
 * (8:15), not equal to it. That's not a rounding artifact; it's true for
 * every possible split of prep/buffer. A second, independent constant is
 * structurally required, so `food_out_target` uses its own
 * `expoBufferMinutes` setting (plate-to-table time after the longest
 * item finishes cooking) rather than reusing `avgPrepBufferMinutes`.
 *
 * Timezone/DST: every value in and out of this module is an instant
 * (`Date`, i.e. a UTC epoch), and all arithmetic here is instant
 * arithmetic (`getTime() +/- minutes * 60_000`) -- never a parse/format
 * of a local wall-clock string. That's what makes it DST-safe: a DST
 * transition changes how an instant is *displayed* in a given timezone,
 * never how many real minutes sit between two instants. This module
 * never formats anything for display, so it never touches
 * `Restaurant.timezone` at all -- that only matters to whichever future
 * checkpoint (CP8) renders these targets on a screen, and it should do
 * that formatting with `Intl.DateTimeFormat(restaurant.timezone, ...)`
 * against these same instants, never by doing arithmetic on local-time
 * strings. See timing-engine.spec.ts's DST test for a worked proof.
 */

export interface RestaurantTimingSettings {
  /** Minutes of lead time before the longest item's prep must start, beyond the prep time itself. */
  avgPrepBufferMinutes: number;
  /** Minutes from the longest item finishing cooking to food actually reaching the table. */
  expoBufferMinutes: number;
}

export interface TimingTargets {
  kitchenStartTarget: Date;
  foodOutTarget: Date;
}

export class InvalidTimingInputError extends Error {}

/**
 * Computes when the kitchen should start prep and when food should be out,
 * given a party's arrival ETA and the prep times of everything they
 * ordered. Longest-prep-item-wins: the kitchen has to start early enough
 * for the slowest dish, and once that dish starts, the whole order is
 * timed off it (real kitchens fire tickets together, not per-dish).
 */
export function computeTimingTargets(
  arrivalEta: Date,
  itemPrepTimesMinutes: number[],
  settings: RestaurantTimingSettings,
): TimingTargets {
  if (itemPrepTimesMinutes.length === 0) {
    throw new InvalidTimingInputError('computeTimingTargets requires at least one ordered item with a prep time');
  }
  if (itemPrepTimesMinutes.some((minutes) => !Number.isFinite(minutes) || minutes <= 0)) {
    throw new InvalidTimingInputError('every item prep time must be a positive, finite number of minutes');
  }

  const longestPrepMinutes = Math.max(...itemPrepTimesMinutes);
  const kitchenStartTarget = addMinutes(arrivalEta, -(longestPrepMinutes + settings.avgPrepBufferMinutes));
  const foodOutTarget = addMinutes(kitchenStartTarget, longestPrepMinutes + settings.expoBufferMinutes);

  return { kitchenStartTarget, foodOutTarget };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
