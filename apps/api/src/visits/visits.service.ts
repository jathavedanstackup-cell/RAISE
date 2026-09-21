import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ConfirmVisitResponse, ConfirmRejectionBody, AllergenTag } from '@raise/shared-types';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { VISIT_CONFIRMED, VisitConfirmedEvent } from '../realtime/realtime.events.js';

const VISIT_INCLUDE = { visitItems: { include: { menuItem: true } }, table: true } as const;
type VisitWithItemsAndTable = Prisma.VisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

/** Thrown internally when the atomic table claim loses the race; always caught inside `confirm` and translated to an honest 409. Never escapes this file. */
class TableTakenError extends Error {}
/** Thrown internally when the atomic visit-status claim finds the row already moved (a concurrent duplicate confirm, or a genuinely invalid state); always caught and re-resolved inside `confirm`. */
class VisitClaimLostError extends Error {}

/**
 * CP5 — the explicit confirmation trust boundary (see
 * docs/checkpoints/CP05-confirmation-booking.md and docs/decisions.md).
 * `confirm` is the ONLY method anywhere in this codebase that may write
 * `Visit.status = 'confirmed'`. Every other status transition (draft's
 * own lifecycle, or later checkpoints' kitchen/table/food-out states) is
 * a different write path entirely; this class never exposes a generic
 * "set status" method that a future caller could misuse.
 */
@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Idempotent: calling this twice for the same visit (double-tap, retry,
   * network replay) produces exactly one booking — the second call
   * returns the same confirmed state with `alreadyConfirmed: true`, not
   * an error and not a second booking. Concurrency-safe: two different
   * visits racing for the same table are serialized by Postgres's own
   * row-level locking on a single atomic `UPDATE ... WHERE status =
   * 'free'` — never a read-then-write in this method. See
   * docs/decisions.md for why, and the concurrency test that races two
   * real confirms against the same table.
   */
  async confirm(restaurantId: string, visitId: string, customerId: string): Promise<ConfirmVisitResponse> {
    const visit = await this.getVisitOrThrow(restaurantId, visitId);

    // Idempotency, checked before touching anything: already confirmed by
    // an earlier call (this one or a concurrent one) is success, not error
    // — but only for the customer already bound to it. A different
    // verified customer hitting an already-confirmed visit gets a 404,
    // same "don't confirm the record exists" reasoning as StaffRestaurantGuard.
    if (visit.status === 'confirmed') {
      if (visit.customerId !== customerId) throw new NotFoundException();
      return { visit: toConfirmedDto(visit), alreadyConfirmed: true };
    }
    if (visit.status !== 'draft') {
      throw new ConflictException(rejection('not_draft', "This visit can't be confirmed from its current state."));
    }

    // Identity binding (closes the threat model's TM-03 finding): the
    // draft token alone is never sufficient — a verified customer must
    // either be the one already linked to this draft, or be the first to
    // claim an unlinked one. A second, different verified customer can
    // never confirm someone else's draft.
    if (visit.customerId !== null && visit.customerId !== customerId) {
      throw new NotFoundException();
    }

    // Read-back completeness: nothing here can be confirmed without a
    // party size, an arrival time, and an assigned table — CP5 ends with
    // "a genuinely held table," not a partial one.
    if (visit.partySize === null) {
      throw new ConflictException(rejection('missing_party_size', "We still need to know your party size before confirming."));
    }
    if (visit.arrivalEta === null) {
      throw new ConflictException(rejection('missing_arrival_eta', "We still need an arrival time before confirming."));
    }
    if (visit.tableId === null) {
      throw new ConflictException(rejection('missing_table', "We haven't picked a table yet — let's find one first."));
    }

    // Re-ground immediately before writing anything: a menu item that
    // went unavailable between the read-back and this call must block
    // confirmation, not be silently confirmed as stale data.
    const unavailable = visit.visitItems.filter((item) => !item.menuItem.available);
    if (unavailable.length > 0) {
      throw new ConflictException(
        rejection(
          'items_unavailable',
          "One or more items are no longer available — please update your order before confirming.",
          unavailable.map((item) => ({ visitItemId: item.id, name: item.menuItem.name })),
        ),
      );
    }

    try {
      const confirmed = await this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
        // Atomic conditional update — the actual enforcement mechanism,
        // not a read-then-write. If a concurrent request already flipped
        // this row (duplicate confirm, or a race with itself), count is 0.
        const visitClaim = await tx.visit.updateMany({
          where: { id: visitId, restaurantId, status: 'draft' },
          data: { status: 'confirmed', arrivalConfirmedAt: new Date(), customerId },
        });
        if (visitClaim.count === 0) throw new VisitClaimLostError();

        // Same pattern for the table: CP4 only ever proposed it
        // (Table.status stayed 'free' the whole draft phase — see
        // docs/decisions.md Part 8 Q3). This is the one place in the
        // codebase that takes a real hold. Two guests racing for the same
        // table both attempt this UPDATE; Postgres serializes them at the
        // row level, so exactly one WHERE clause still matches.
        const tableClaim = await tx.table.updateMany({
          where: { id: visit.tableId!, restaurantId, status: 'free' },
          data: { status: 'held' },
        });
        if (tableClaim.count === 0) throw new TableTakenError();

        await tx.visit.updateMany({
          where: { id: visitId, restaurantId },
          data: { tableAssignedAt: new Date() },
        });

        await tx.visitStatusEvent.create({
          data: {
            restaurantId,
            visitId,
            status: 'confirmed',
            actorType: 'customer',
            actorId: customerId,
            mechanism: 'explicit_confirm_endpoint',
          },
        });

        return tx.visit.findUniqueOrThrow({ where: { id: visitId }, include: VISIT_INCLUDE });
      });

      // CP7: additive only -- never lets a downstream listener's failure affect this trust-boundary response.
      // See docs/decisions.md's CP6 entry for why nothing here automatically triggers CP6's timing
      // computation; this is the analogous, deliberately narrow exception for the dashboard's own live feed.
      try {
        this.events.emit(VISIT_CONFIRMED, new VisitConfirmedEvent(restaurantId, visitId));
      } catch (err) {
        this.logger.error('Failed to emit VISIT_CONFIRMED -- confirm itself still succeeded', err as Error);
      }

      return { visit: toConfirmedDto(confirmed), alreadyConfirmed: false };
    } catch (err) {
      if (err instanceof VisitClaimLostError) {
        // Lost the race to a concurrent call for the SAME visit. If that
        // winner was this same customer, it's a genuine double-tap/retry
        // — idempotent success. Otherwise, something else changed the
        // row between our pre-check and the transaction; report honestly.
        const current = await this.getVisitOrThrow(restaurantId, visitId);
        if (current.status === 'confirmed' && current.customerId === customerId) {
          return { visit: toConfirmedDto(current), alreadyConfirmed: true };
        }
        throw new ConflictException(rejection('not_draft', "This visit can't be confirmed from its current state."));
      }
      if (err instanceof TableTakenError) {
        throw new ConflictException(rejection('table_taken', "That table just went — want to try a different one?"));
      }
      throw err;
    }
  }

  private async getVisitOrThrow(restaurantId: string, visitId: string): Promise<VisitWithItemsAndTable> {
    const visit = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.findFirst({ where: { id: visitId, restaurantId }, include: VISIT_INCLUDE }),
    );
    if (!visit) throw new NotFoundException();
    return visit;
  }
}

function rejection(
  reason: ConfirmRejectionBody['reason'],
  message: string,
  unavailableItems?: ConfirmRejectionBody['unavailableItems'],
): ConfirmRejectionBody {
  return { reason, message, ...(unavailableItems ? { unavailableItems } : {}) };
}

function toConfirmedDto(visit: VisitWithItemsAndTable): ConfirmVisitResponse['visit'] {
  if (!visit.table) throw new Error('Invariant violated: a confirmed visit must have a table.');
  return {
    id: visit.id,
    restaurantId: visit.restaurantId,
    status: 'confirmed',
    partySize: visit.partySize!,
    arrivalEta: visit.arrivalEta!.toISOString(),
    arrivalConfirmedAt: visit.arrivalConfirmedAt!.toISOString(),
    table: { id: visit.table.id, label: visit.table.label },
    items: visit.visitItems.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.menuItem.name,
      price: item.menuItem.price.toString(),
      quantity: item.quantity,
      modifications: item.modifications,
      allergyFlags: item.allergyFlags as AllergenTag[],
    })),
  };
}
