import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ReassignTableRejectionBody, ReassignTableResponse } from '@raise/shared-types';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { VISIT_TABLE_REASSIGNED, VisitTableReassignedEvent } from '../realtime/realtime.events.js';

/** A visit still has a physical table need in these statuses; reassigning after food_out (or before confirm) doesn't make sense. */
const ACTIVE_STATUSES = ['confirmed', 'kitchen_started', 'table_set', 'guest_arrived'] as const;

class TableTakenError extends Error {}
class StaleVisitTableError extends Error {}

function rejection(reason: ReassignTableRejectionBody['reason'], message: string): ReassignTableRejectionBody {
  return { reason, message };
}

/**
 * CP7 — manual table reassignment. The non-negotiable from this
 * checkpoint's brief applies here exactly as it did in CP5/CP6: any
 * check-then-write against a status is a single atomic conditional
 * UPDATE, never a read followed by an unguarded write. Two staff
 * reassigning the same visit to two different tables concurrently must
 * not both succeed, and the losing attempt must not silently overwrite
 * the winner -- see table-reassignment.e2e-spec.ts's CONCURRENCY test.
 */
@Injectable()
export class TableReassignmentService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async reassign(restaurantId: string, visitId: string, newTableId: string, staffUserId: string): Promise<ReassignTableResponse> {
    const visit = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.findFirst({ where: { id: visitId, restaurantId } }),
    );
    if (!visit) throw new NotFoundException();
    if (!(ACTIVE_STATUSES as readonly string[]).includes(visit.status)) {
      throw new ConflictException(rejection('visit_not_active', "This visit doesn't have an active table assignment to reassign."));
    }
    if (visit.tableId === null) {
      throw new ConflictException(rejection('visit_not_active', 'This visit has no table assigned yet.'));
    }
    if (visit.tableId === newTableId) {
      // Idempotent no-op: reassigning to the table it's already at is success, not an error.
      return { visitId, tableId: newTableId, alreadyAssigned: true };
    }
    const previousTableId = visit.tableId;

    try {
      await this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
        // Claim the new table atomically -- only if it's genuinely free right now.
        const newTableClaim = await tx.table.updateMany({
          where: { id: newTableId, restaurantId, status: 'free' },
          data: { status: 'held' },
        });
        if (newTableClaim.count === 0) throw new TableTakenError();

        // Move the visit atomically -- only if it's still exactly where we last read it (optimistic lock, same shape as CP6's ETA-drift guard).
        const visitClaim = await tx.visit.updateMany({
          where: { id: visitId, restaurantId, tableId: previousTableId, status: { in: [...ACTIVE_STATUSES] } },
          data: { tableId: newTableId, tableAssignedAt: new Date() },
        });
        if (visitClaim.count === 0) throw new StaleVisitTableError();

        // Only now release the old table -- if either prior step threw, this transaction rolls back and the old table was never touched.
        await tx.table.updateMany({ where: { id: previousTableId, restaurantId, status: 'held' }, data: { status: 'free' } });
      });
    } catch (err) {
      if (err instanceof TableTakenError) {
        throw new ConflictException(rejection('table_taken', "That table isn't free — someone else has it."));
      }
      if (err instanceof StaleVisitTableError) {
        throw new ConflictException(rejection('stale_update', 'This visit was reassigned by someone else just now.'));
      }
      throw err;
    }

    this.events.emit(
      VISIT_TABLE_REASSIGNED,
      new VisitTableReassignedEvent(restaurantId, visitId, previousTableId, newTableId, staffUserId),
    );
    return { visitId, tableId: newTableId, alreadyAssigned: false };
  }
}
