import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VISIT_CONFIRMED, VisitConfirmedEvent } from '../realtime/realtime.events.js';
import { VISIT_TIMING_RECOMPUTED, VisitTimingRecomputedEvent } from '../timing/timing.events.js';
import { NotificationService } from './notification.service.js';

/**
 * CP9 — the only place domain events are turned into notification
 * attempts. Deliberately thin: it decides *which* notification a given
 * domain event calls for and nothing else. Whether that notification has
 * already been claimed, and therefore must not be sent again, is
 * NotificationService's business alone (`claimThenSend`) — this class
 * must never grow its own "have I seen this event?" bookkeeping, because
 * in-process memory is exactly the kind of state that a restart or a
 * second API instance would silently lose, and losing it would mean a
 * duplicate SMS to a real guest. The database constraint is the
 * guarantee; this file merely routes.
 *
 * Handlers are `async void` from EventEmitter2's point of view — it does
 * not await them and a rejection here would be an unhandled promise
 * rejection — so each one catches its own errors. A notification that
 * fails must never take down the domain operation (the confirm, the
 * recompute) that triggered it; CP5 set that precedent when it wrapped
 * its own emit in a try/catch.
 */
@Injectable()
export class NotificationSubscriber {
  private readonly logger = new Logger(NotificationSubscriber.name);

  constructor(private readonly notifications: NotificationService) {}

  /**
   * A confirmed visit produces two notifications, one per audience: the
   * guest's confirmation SMS and the restaurant's new-inbound alert.
   * They are separate `type`s, so they claim separately — one failing or
   * being re-attempted never suppresses the other.
   */
  @OnEvent(VISIT_CONFIRMED)
  async onVisitConfirmed(event: VisitConfirmedEvent): Promise<void> {
    await this.run('visit.confirmed', event.visitId, async () => {
      await this.notifications.sendBookingConfirmation(event.restaurantId, event.visitId);
      await this.notifications.sendNewInboundAlert(event.restaurantId, event.visitId);
    });
  }

  /**
   * Drift alerts are for ETA changes the guest made AFTER confirming —
   * `reason === 'eta_changed'`. An `items_changed` recompute moves the
   * same targets, but it is the restaurant's own staff editing the
   * order: they already know, and alerting them about a change they just
   * made is the kind of noise that gets a whole alert channel ignored.
   * An 'initial' computation has no previous target to drift from at all.
   */
  @OnEvent(VISIT_TIMING_RECOMPUTED)
  async onTimingRecomputed(event: VisitTimingRecomputedEvent): Promise<void> {
    if (event.reason !== 'eta_changed') return;
    if (!event.previousKitchenStartTarget) return;

    const driftMs = event.kitchenStartTarget.getTime() - event.previousKitchenStartTarget.getTime();
    await this.run('visit.timing.recomputed', event.visitId, () =>
      this.notifications.sendDriftAlertIfSignificant(event.restaurantId, event.visitId, driftMs),
    );
  }

  private async run(eventName: string, visitId: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (err) {
      // Swallowed on purpose: see the class comment. The domain operation
      // that emitted this event has already committed and must not be
      // affected by a notification failure.
      this.logger.error(`Notification handling failed for ${eventName} (visitId=${visitId})`, err as Error);
    }
  }
}
