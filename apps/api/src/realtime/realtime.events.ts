/**
 * CP7's own additions to the realtime event contract CP6 started
 * (visit.timing.recomputed / visit.kitchen.accepted, in
 * ../timing/timing.events.ts — VisitsGateway subscribes to both sets).
 * Same shape: small, typed, carrying only ids and the changed fields.
 */

export const VISIT_CONFIRMED = 'visit.confirmed';
export const VISIT_TABLE_REASSIGNED = 'visit.table_reassigned';

export class VisitConfirmedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
  ) {}
}

export class VisitTableReassignedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
    public readonly previousTableId: string,
    public readonly newTableId: string,
    public readonly staffUserId: string,
  ) {}
}
