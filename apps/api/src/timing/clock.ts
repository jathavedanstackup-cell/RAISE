/**
 * CP6: the one place `TimingService` is allowed to ask what time it is.
 * Every other timing decision goes through `computeTimingTargets`, which
 * never touches the clock at all -- see timing-engine.ts. Injected via DI
 * so tests can supply a fixed or advancing time instead of the real one.
 */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
