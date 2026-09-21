/**
 * CP6's realtime event contract for CP7 (FOH dashboard) and CP8 (kitchen
 * display) to consume later -- neither is built here. Kept deliberately
 * small: two events, both carrying only ids and the new instants, no
 * consumer-specific shaping. Emitted via `EventEmitter2`
 * (`@nestjs/event-emitter`, the NestJS-documented pattern -- see
 * docs.nestjs.com/techniques/events, confirmed live via Context7 since no
 * installed skill covers NestJS realtime/event-emission specifically).
 *
 * `EventEmitter2` is in-process only -- it does not itself reach a
 * browser. A future WebSocket Gateway (or SSE endpoint) is what CP7/CP8
 * would add to relay these across the wire; that consumer is explicitly
 * out of scope for this checkpoint.
 */

export const VISIT_TIMING_RECOMPUTED = 'visit.timing.recomputed';
export const VISIT_KITCHEN_ACCEPTED = 'visit.kitchen.accepted';

export class VisitTimingRecomputedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
    public readonly kitchenStartTarget: Date,
    public readonly foodOutTarget: Date,
    /**
     * The kitchen-start target this recompute REPLACED, or `null` when the
     * visit had none yet (the first computation). Added in CP9: a drift
     * alert is about the MAGNITUDE of the change, and magnitude is not
     * derivable from the new value alone. Deliberately the previous
     * target rather than the previous ETA -- the target is what the
     * kitchen actually works to, and it is the buffer-adjusted quantity
     * the drift threshold is calibrated against (see drift-policy.ts).
     */
    public readonly previousKitchenStartTarget: Date | null,
    /** Why this recompute happened -- lets a consumer decide whether to interrupt a kitchen screen or just quietly update a countdown. */
    public readonly reason: 'initial' | 'eta_changed' | 'items_changed',
  ) {}
}

export class VisitKitchenAcceptedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
    public readonly acceptedAt: Date,
    public readonly staffUserId: string,
  ) {}
}
