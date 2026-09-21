import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { formatClockTime } from '@raise/shared-types';
import { Prisma } from '../generated/prisma/client.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { CLOCK, type Clock } from '../timing/clock.js';
import { SMS_PROVIDER, type SmsProvider } from './sms/sms-provider.interface.js';
import {
  ETA_DRIFT_ALERT,
  EtaDriftAlertEvent,
  NEW_INBOUND_ALERT,
  NewInboundAlertEvent,
} from './notification.events.js';
import { isSignificantDrift } from './drift-policy.js';

export type NotificationType = 'booking_confirmation' | 'new_inbound_alert' | 'eta_drift_alert';

const VISIT_INCLUDE = { customer: true, table: true, restaurant: true } as const;

/**
 * CP9 — every send goes through `claimThenSend`. That is the whole
 * idempotency story: a claim row is INSERTed, guarded by the unique
 * constraint on `(visitId, type)`, BEFORE the actual send is attempted.
 * A retry, a reconnect, or the same domain event handled twice all
 * produce the identical INSERT, which the database rejects the second
 * time — never a second SMS, never a second alert. See
 * docs/decisions.md's CP9 entry for why (visitId, type) — not a third
 * "which occurrence" key — is the deliberately chosen granularity.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Claims (visitId, type) atomically, then runs `send`. If the claim
   * loses to an existing row (this exact notification was already
   * attempted, sent or not), `send` never runs — that is the guarantee.
   * A `send` that throws marks the row "failed" rather than leaving it
   * "pending" forever, but does not retry: there is no redelivery worker
   * in this checkpoint's scope (documented, not an oversight).
   */
  private async claimThenSend(
    restaurantId: string,
    visitId: string,
    type: NotificationType,
    channel: string,
    // Prisma.InputJsonObject rather than Record<string, unknown>: the Json
    // column genuinely cannot hold `undefined` or a function, and widening
    // it here would push that failure to runtime.
    payload: Prisma.InputJsonObject,
    send: () => Promise<Prisma.InputJsonObject>,
  ): Promise<void> {
    const claimed = await this.tenantPrisma.forRestaurant(restaurantId, async (tx) => {
      try {
        return await tx.notificationLog.create({ data: { restaurantId, visitId, type, channel, payload } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      }
    });
    if (!claimed) return; // already claimed -- this is the idempotency guarantee, not an error

    try {
      const sentPayload = await send();
      await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
        tx.notificationLog.update({
          where: { id: claimed.id },
          data: { status: 'sent', sentAt: this.clock.now(), payload: { ...payload, ...sentPayload } },
        }),
      );
    } catch (err) {
      this.logger.error(`Notification send failed (type=${type}, visitId=${visitId})`, err as Error);
      await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
        tx.notificationLog.update({ where: { id: claimed.id }, data: { status: 'failed' } }),
      );
    }
  }

  /** Fires once per visit, ever — the customer's booking confirmation SMS. */
  async sendBookingConfirmation(restaurantId: string, visitId: string): Promise<void> {
    const visit = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.findFirst({ where: { id: visitId, restaurantId }, include: VISIT_INCLUDE }),
    );
    if (!visit || !visit.customer || !visit.table || !visit.arrivalEta) return; // not a bookable state -- nothing to confirm

    // CP10 fix. This was `arrivalEta.toISOString().slice(11, 16)` -- UTC.
    // A guest booked for 8:15 PM at a Los Angeles restaurant received a
    // text saying "arriving 14:45". Found by reading an actual sent
    // message during CP10's QA pass; invisible to the whole e2e suite,
    // which seeds every restaurant as UTC.
    const time = formatClockTime(visit.arrivalEta, visit.restaurant.timezone);
    const body = `${visit.restaurant.name}: you're booked for ${visit.partySize} at table ${visit.table.label}, arriving ${time}. See you soon!`;

    await this.claimThenSend(restaurantId, visitId, 'booking_confirmation', 'sms', { to: visit.customer.phone, body }, async () => {
      const result = await this.sms.send(visit.customer!.phone, body);
      return { providerMessageId: result.providerMessageId };
    });
  }

  /** Fires once per visit, ever — the in-app alert on the FOH dashboard for a newly confirmed visit. */
  async sendNewInboundAlert(restaurantId: string, visitId: string): Promise<void> {
    await this.claimThenSend(restaurantId, visitId, 'new_inbound_alert', 'in_app', { visitId }, async () => {
      this.events.emit(NEW_INBOUND_ALERT, new NewInboundAlertEvent(restaurantId, visitId));
      return {};
    });
  }

  /**
   * Fires at most once per visit, ever, the first time a post-confirmation
   * ETA drift clears `isSignificantDrift`'s threshold. A second, later
   * drift on the same visit does not re-alert — see docs/decisions.md's
   * CP9 entry for why that is the deliberate choice, not a gap.
   */
  async sendDriftAlertIfSignificant(restaurantId: string, visitId: string, driftMs: number): Promise<void> {
    if (!isSignificantDrift(driftMs)) return;
    const driftMinutes = Math.round(driftMs / 60_000);

    await this.claimThenSend(restaurantId, visitId, 'eta_drift_alert', 'in_app', { driftMinutes }, async () => {
      this.events.emit(ETA_DRIFT_ALERT, new EtaDriftAlertEvent(restaurantId, visitId, driftMinutes));
      return {};
    });
  }
}
