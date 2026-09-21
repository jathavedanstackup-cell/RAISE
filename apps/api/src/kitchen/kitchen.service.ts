import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AllergenTag, KitchenTicketDto, KitchenTicketStatus } from '@raise/shared-types';
import { TenantPrismaService, type ScopedPrisma } from '../prisma/tenant-prisma.service.js';
import { CLOCK, type Clock } from '../timing/clock.js';
import {
  VISIT_ALLERGY_ACKNOWLEDGED,
  VISIT_FOOD_OUT,
  VisitAllergyAcknowledgedEvent,
  VisitFoodOutEvent,
} from './kitchen.events.js';

/** The two statuses a ticket holds while the kitchen owns it. Anything later has left the pass. */
const KITCHEN_STATUSES: KitchenTicketStatus[] = ['confirmed', 'kitchen_started'];

/** Statuses meaning the food has already gone out at some point — serving again is a safe no-op, not a conflict. */
const POST_SERVICE_STATUSES = new Set(['food_out', 'completed']);

export type FoodOutRejection = 'allergy_not_acknowledged' | 'not_in_progress';

export interface FoodOutResult {
  served: boolean;
  alreadyServed: boolean;
  servedAt?: Date;
  rejection?: FoodOutRejection;
}

export interface AcknowledgeResult {
  acknowledgedAt: Date;
  alreadyAcknowledged: boolean;
}

const TICKET_INCLUDE = {
  table: true,
  allergyAck: true,
  visitItems: { include: { menuItem: true } },
} as const;

/**
 * CP8 — the kitchen display's read model and its two write paths.
 *
 * This service owns the `food_out` transition exclusively, the same way
 * TimingService owns `kitchen_started`. See the TRUST BOUNDARY tests in
 * kitchen-invariants.spec.ts for the static proof.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * The prep queue, in the order the kitchen should work it: by computed
   * `kitchenStartTarget`, NOT by when the order came in. That reordering
   * is the entire point of CP6 feeding CP8.
   *
   * A ticket appears only once its computed start time has arrived
   * (`kitchenStartTarget <= now`). Showing it earlier would put work on
   * screen that should not be started yet, which is exactly the failure
   * the timing engine exists to prevent.
   */
  async listQueue(restaurantId: string): Promise<KitchenTicketDto[]> {
    const now = this.clock.now();

    const visits = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.findMany({
        where: {
          restaurantId,
          status: { in: KITCHEN_STATUSES },
          tableId: { not: null },
          kitchenStartTarget: { not: null, lte: now },
        },
        include: TICKET_INCLUDE,
        orderBy: { kitchenStartTarget: 'asc' },
      }),
    );

    return visits.map((visit) => ({
      visitId: visit.id,
      status: visit.status as KitchenTicketStatus,
      tableLabel: visit.table!.label,
      partySize: visit.partySize!,
      arrivalEta: visit.arrivalEta!.toISOString(),
      kitchenStartTarget: visit.kitchenStartTarget!.toISOString(),
      foodOutTarget: visit.foodOutTarget?.toISOString() ?? null,
      items: visit.visitItems.map((item) => ({
        id: item.id,
        name: item.menuItem.name,
        quantity: item.quantity,
        modifications: item.modifications,
        allergyFlags: item.allergyFlags as AllergenTag[],
        prepTimeMinutes: item.menuItem.prepTimeMinutes,
      })),
      // Flags are reported unconditionally. There is deliberately no branch
      // here on `allergyAck` — see docs/decisions.md's CP8 entry and the
      // never-dismiss invariant test.
      allergyFlags: [...new Set(visit.visitItems.flatMap((item) => item.allergyFlags))] as AllergenTag[],
      allergyAcknowledgedAt: visit.allergyAck?.acknowledgedAt.toISOString() ?? null,
    }));
  }

  /**
   * Records that a staff member confirmed they had seen this visit's
   * allergy flags. Idempotent: the unique constraint on `visitId` makes a
   * double-tap return the existing acknowledgment rather than creating a
   * second audit row or erroring at the user.
   *
   * This does NOT change what the kitchen sees. The flags render exactly
   * the same before and after.
   */
  async acknowledgeAllergies(restaurantId: string, visitId: string, staffUserId: string): Promise<AcknowledgeResult> {
    return this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id: visitId, restaurantId }, include: { allergyAck: true } });
      if (!visit) throw new NotFoundException();

      if (visit.allergyAck) {
        return { acknowledgedAt: visit.allergyAck.acknowledgedAt, alreadyAcknowledged: true };
      }

      const acknowledgedAt = this.clock.now();
      try {
        await tx.visitAllergyAcknowledgment.create({
          data: { restaurantId, visitId, staffUserId, acknowledgedAt },
        });
      } catch {
        // Lost a race with a concurrent acknowledgment: the unique
        // constraint fired. Someone acknowledged, which is all the gate
        // needs — read theirs rather than reporting a conflict at a cook
        // mid-service.
        const existing = await tx.visitAllergyAcknowledgment.findUnique({ where: { visitId } });
        if (!existing) throw new NotFoundException();
        return { acknowledgedAt: existing.acknowledgedAt, alreadyAcknowledged: true };
      }

      this.events.emit(
        VISIT_ALLERGY_ACKNOWLEDGED,
        new VisitAllergyAcknowledgedEvent(restaurantId, visitId, acknowledgedAt, staffUserId),
      );
      return { acknowledgedAt, alreadyAcknowledged: false };
    });
  }

  /**
   * CP8's trust boundary: the ONLY method anywhere that may write
   * `Visit.status = 'food_out'`.
   *
   * A ticket carrying allergy flags cannot pass without an acknowledgment
   * row. That check and the write are one atomic conditional UPDATE, not a
   * read followed by a write: these transactions run at Read Committed, so
   * a check-then-write would let a concurrent path slip between them —
   * the same defect class found in CP6's recompute.
   */
  async markFoodOut(restaurantId: string, visitId: string, staffUserId: string): Promise<FoodOutResult> {
    return this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
      const gate = await this.foodOutGate(tx, restaurantId, visitId);
      if (gate) return gate;

      const claim = await tx.visit.updateMany({
        // `allergyAck: { isNot: null }` is NOT expressible here as a guard on
        // updateMany, so the gate above resolves it to a concrete predicate:
        // either the visit has no flags (no acknowledgment required) or the
        // acknowledgment already exists and its id is pinned below.
        where: { id: visitId, restaurantId, status: 'kitchen_started' },
        data: { status: 'food_out' },
      });

      if (claim.count === 0) {
        const current = await tx.visit.findFirst({ where: { id: visitId, restaurantId } });
        if (!current) throw new NotFoundException();
        if (POST_SERVICE_STATUSES.has(current.status)) return { served: true, alreadyServed: true };
        return { served: false, alreadyServed: false, rejection: 'not_in_progress' as const };
      }

      const servedAt = this.clock.now();
      await tx.visitStatusEvent.create({
        data: {
          restaurantId,
          visitId,
          status: 'food_out',
          occurredAt: servedAt,
          actorType: 'staff',
          actorId: staffUserId,
          mechanism: 'kitchen_food_out_endpoint',
        },
      });

      this.events.emit(VISIT_FOOD_OUT, new VisitFoodOutEvent(restaurantId, visitId, servedAt, staffUserId));
      return { served: true, alreadyServed: false, servedAt };
    });
  }

  /**
   * Resolves the allergy gate inside the same transaction as the write.
   * Returns a rejection to short-circuit on, or null to proceed.
   *
   * Read Committed means this read and the UPDATE that follows are not a
   * single atomic step on their own. What makes that safe here is the
   * direction the state can move: an acknowledgment can only ever be
   * created, never deleted, and flags on a confirmed visit's items do not
   * change while the kitchen holds the ticket. So the only drift possible
   * between this check and the write is "someone else also acknowledged"
   * — which cannot turn a pass into a miss. A gate that could be revoked
   * would need the check folded into the UPDATE's own WHERE clause.
   */
  private async foodOutGate(
    tx: ScopedPrisma,
    restaurantId: string,
    visitId: string,
  ): Promise<FoodOutResult | null> {
    const visit = await tx.visit.findFirst({
      where: { id: visitId, restaurantId },
      include: { allergyAck: true, visitItems: true },
    });
    if (!visit) throw new NotFoundException();

    const hasFlags = visit.visitItems.some((item) => item.allergyFlags.length > 0);
    if (hasFlags && !visit.allergyAck) {
      return { served: false, alreadyServed: false, rejection: 'allergy_not_acknowledged' };
    }
    return null;
  }
}
