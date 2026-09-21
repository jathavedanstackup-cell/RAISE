/**
 * CP9's own additions to the realtime event contract CP6/CP7 started.
 * VisitsGateway subscribes to these too -- see its own file. These are
 * the "alert" half of a notification (what gets pushed live to a
 * connected dashboard/kitchen screen); the NotificationLog row is the
 * "did this actually get claimed and sent" half. Emitted only after the
 * claim-then-send in NotificationService succeeds, never before.
 */

export const NEW_INBOUND_ALERT = 'notification.new_inbound_alert';
export const ETA_DRIFT_ALERT = 'notification.eta_drift_alert';

export class NewInboundAlertEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
  ) {}
}

export class EtaDriftAlertEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly visitId: string,
    public readonly driftMinutes: number,
  ) {}
}
