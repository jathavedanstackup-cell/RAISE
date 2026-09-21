import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantPrismaService, type ScopedPrisma } from '../prisma/tenant-prisma.service.js';
import { CLOCK, type Clock } from './clock.js';
import { computeTimingTargets, InvalidTimingInputError, type TimingTargets } from './timing-engine.js';
import {
  VISIT_KITCHEN_ACCEPTED,
  VISIT_TIMING_RECOMPUTED,
  VisitKitchenAcceptedEvent,
  VisitTimingRecomputedEvent,
} from './timing.events.js';

export type RecomputeRejection = 'visit_not_confirmed' | 'visit_not_ready' | 'stale_update';

export interface RecomputeResult {
  applied: boolean;
  targets?: TimingTargets;
  rejection?: RecomputeRejection;
}

export type KitchenAcceptRejection = 'not_confirmed';

export interface KitchenAcceptResult {
  accepted: boolean;
  alreadyAccepted: boolean;
  acceptedAt?: Date;
  rejection?: KitchenAcceptRejection;
}

/** Statuses that mean kitchen prep has already started at some point -- accepting again against any of these is a safe no-op, not a conflict. */
const POST_KITCHEN_STATUSES = new Set(['kitchen_started', 'table_set', 'guest_arrived', 'food_out', 'completed']);

function isValidBufferMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * CP6 — orchestrates the pure calculation in timing-engine.ts against
 * real Visit/Restaurant rows, and owns the one write path to
 * `kitchen_started`. See docs/decisions.md for the full design writeup.
 */
@Injectable()
export class TimingService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Recomputes targets from whatever is currently on the row. Safe to
   * call any time for a confirmed visit with a table, an arrival ETA, and
   * at least one item — including as the very first computation (nothing
   * automatically triggers that yet; see docs/decisions.md's CP6 entry
   * for why that trigger is deliberately left for whichever checkpoint
   * first needs it) and after an order-item change.
   */
  async recompute(restaurantId: string, visitId: string): Promise<RecomputeResult> {
    return this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      this.recomputeTargets(tx, restaurantId, visitId, 'items_changed'),
    );
  }

  /**
   * Recomputes for a customer-driven ETA change. `expectedUpdatedAt` is
   * an optimistic-concurrency token — the visit's own `updatedAt`, as the
   * caller last observed it — checked with the same atomic
   * conditional-UPDATE pattern CP5 used for the confirm/table claims:
   * several ETA updates in rapid succession race exactly like two guests
   * claiming the last table did, and get the same fix. If the row has
   * moved since the caller last read it (a newer update already won, or
   * the visit left `confirmed`), this update is rejected outright rather
   * than silently overwriting a fresher state with a stale one.
   */
  async recomputeForEtaChange(
    restaurantId: string,
    visitId: string,
    newArrivalEta: Date,
    expectedUpdatedAt: Date,
  ): Promise<RecomputeResult> {
    return this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
      const claim = await tx.visit.updateMany({
        where: { id: visitId, restaurantId, status: 'confirmed', updatedAt: expectedUpdatedAt },
        data: { arrivalEta: newArrivalEta },
      });
      if (claim.count === 0) {
        const current = await tx.visit.findFirst({ where: { id: visitId, restaurantId } });
        if (!current) throw new NotFoundException();
        // Distinguish "you cannot un-cook food" (kitchen already moved on) from a genuine race between two ETA updates.
        if (current.status !== 'confirmed') return { applied: false, rejection: 'visit_not_confirmed' as const };
        return { applied: false, rejection: 'stale_update' as const };
      }
      return this.recomputeTargets(tx, restaurantId, visitId, 'eta_changed');
    });
  }

  private async recomputeTargets(
    tx: ScopedPrisma,
    restaurantId: string,
    visitId: string,
    reason: 'eta_changed' | 'items_changed',
  ): Promise<RecomputeResult> {
    const visit = await tx.visit.findFirst({
      where: { id: visitId, restaurantId },
      include: { visitItems: { include: { menuItem: true } }, restaurant: true },
    });
    if (!visit) throw new NotFoundException();

    // "You cannot un-cook food": once the kitchen has actually started (or moved further), targets become
    // historical facts, not predictions — recompute is a no-op rather than silently rewriting them.
    if (visit.status !== 'confirmed') return { applied: false, rejection: 'visit_not_confirmed' };
    if (!visit.arrivalEta || visit.visitItems.length === 0) return { applied: false, rejection: 'visit_not_ready' };

    const settings = visit.restaurant.settings as { avgPrepBufferMinutes?: unknown; expoBufferMinutes?: unknown };
    if (!isValidBufferMinutes(settings.avgPrepBufferMinutes) || !isValidBufferMinutes(settings.expoBufferMinutes)) {
      return { applied: false, rejection: 'visit_not_ready' };
    }

    let targets: TimingTargets;
    try {
      targets = computeTimingTargets(
        visit.arrivalEta,
        visit.visitItems.map((item) => item.menuItem.prepTimeMinutes),
        { avgPrepBufferMinutes: settings.avgPrepBufferMinutes, expoBufferMinutes: settings.expoBufferMinutes },
      );
    } catch (err) {
      if (err instanceof InvalidTimingInputError) return { applied: false, rejection: 'visit_not_ready' };
      throw err;
    }

    // Re-assert `status = 'confirmed'` in the WHERE clause rather than trusting the findFirst above.
    // These transactions run at Read Committed, so a concurrent acceptKitchenStart could commit
    // between that read and this write; an unguarded write would then rewrite the targets of a visit
    // whose kitchen has already started -- precisely the "you cannot un-cook food" case. Making the
    // write itself conditional collapses check-and-write into one atomic step, the same fix CP5 used
    // for the confirm/table claims.
    // Captured BEFORE the write, for CP9's drift alert: the target this
    // recompute is about to replace. `null` on the first computation.
    const previousKitchenStartTarget = visit.kitchenStartTarget;

    const written = await tx.visit.updateMany({
      where: { id: visitId, restaurantId, status: 'confirmed' },
      data: { kitchenStartTarget: targets.kitchenStartTarget, foodOutTarget: targets.foodOutTarget },
    });
    if (written.count === 0) return { applied: false, rejection: 'visit_not_confirmed' };

    this.events.emit(
      VISIT_TIMING_RECOMPUTED,
      new VisitTimingRecomputedEvent(
        restaurantId,
        visitId,
        targets.kitchenStartTarget,
        targets.foodOutTarget,
        previousKitchenStartTarget,
        reason,
      ),
    );
    return { applied: true, targets };
  }

  /**
   * CP6's own trust boundary (docs/decisions.md — "Kitchen auto-start vs.
   * staff accept-step", provisional): this is the ONLY method anywhere in
   * the codebase that may write `Visit.status = 'kitchen_started'`.
   * Idempotent, same shape as CP5's confirm — a double-accept (double-tap,
   * retry) returns the already-accepted state, not an error and not a
   * second audit event.
   */
  async acceptKitchenStart(restaurantId: string, visitId: string, staffUserId: string): Promise<KitchenAcceptResult> {
    return this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
      const claim = await tx.visit.updateMany({
        where: { id: visitId, restaurantId, status: 'confirmed' },
        data: { status: 'kitchen_started' },
      });

      if (claim.count === 0) {
        const current = await tx.visit.findFirst({ where: { id: visitId, restaurantId } });
        if (!current) throw new NotFoundException();
        if (POST_KITCHEN_STATUSES.has(current.status)) return { accepted: true, alreadyAccepted: true };
        return { accepted: false, alreadyAccepted: false, rejection: 'not_confirmed' as const };
      }

      const acceptedAt = this.clock.now();
      await tx.visitStatusEvent.create({
        data: {
          restaurantId,
          visitId,
          status: 'kitchen_started',
          occurredAt: acceptedAt,
          actorType: 'staff',
          actorId: staffUserId,
          mechanism: 'kitchen_accept_endpoint',
        },
      });

      this.events.emit(VISIT_KITCHEN_ACCEPTED, new VisitKitchenAcceptedEvent(restaurantId, visitId, acceptedAt, staffUserId));
      return { accepted: true, alreadyAccepted: false, acceptedAt };
    });
  }
}
