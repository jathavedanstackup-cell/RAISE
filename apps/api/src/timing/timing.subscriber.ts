import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VISIT_CONFIRMED, VisitConfirmedEvent } from '../realtime/realtime.events.js';
import { TimingService } from './timing.service.js';

/**
 * CP10 — the trigger CP6 deliberately left for "whichever checkpoint
 * first needs it" (see its entry in docs/decisions.md). CP10 is that
 * checkpoint, and it found out the way these things are usually found
 * out: by opening the product in a browser and booking a table. The
 * dashboard showed "Kitchen start —, Food out —" and the kitchen
 * display said "Nothing due yet", because nothing had ever computed the
 * targets. Every backend test passed throughout, because every one of
 * them called `recompute` itself.
 *
 * Placing it here rather than inside `VisitsService.confirm` is
 * deliberate. `confirm` is CP5's trust boundary — the only method
 * allowed to write `status = 'confirmed'` — and a timing computation
 * that failed inside it would either roll back a booking the guest has
 * already been told is theirs, or need a try/catch that quietly makes
 * `confirm` partially transactional. A visit with no targets is a
 * recoverable state (staff can hit the recompute endpoint; a later ETA
 * change recomputes anyway); a booking that silently didn't happen is
 * not.
 */
@Injectable()
export class TimingSubscriber {
  private readonly logger = new Logger(TimingSubscriber.name);

  constructor(private readonly timing: TimingService) {}

  @OnEvent(VISIT_CONFIRMED)
  async onVisitConfirmed(event: VisitConfirmedEvent): Promise<void> {
    try {
      const result = await this.timing.recompute(event.restaurantId, event.visitId, 'initial');
      if (!result.applied) {
        // Not an error: a visit with no items, or no arrival time, has
        // nothing to compute yet. It gets targets the moment it does.
        this.logger.debug(`No initial timing for visit ${event.visitId}: ${result.rejection}`);
      }
    } catch (err) {
      // The visit no longer exists. Handlers run after the request that
      // emitted the event has returned, so a visit deleted in between is a
      // race, not a fault -- and an ERROR line that appears routinely is how
      // a log stops being read. Anything else genuinely is an error.
      if (err instanceof NotFoundException) {
        this.logger.debug(`Visit ${event.visitId} disappeared before its initial timing could be computed`);
        return;
      }
      this.logger.error(`Initial timing computation failed for visit ${event.visitId}`, err as Error);
    }
  }
}
