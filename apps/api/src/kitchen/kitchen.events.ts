/**
 * CP8's additions to the realtime event contract CP6 and CP7 established
 * (../timing/timing.events.ts, ../realtime/realtime.events.ts). Same
 * shape: small, typed, ids and changed fields only.
 */

export const VISIT_ALLERGY_ACKNOWLEDGED = 'visit.allergy_acknowledged';
export const VISIT_FOOD_OUT = 'visit.food_out';

export class VisitAllergyAcknowledgedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
    public readonly acknowledgedAt: Date,
    public readonly staffUserId: string,
  ) {}
}

export class VisitFoodOutEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
    public readonly servedAt: Date,
    public readonly staffUserId: string,
  ) {}
}
