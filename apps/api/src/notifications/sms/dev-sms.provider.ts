import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider, SmsSendResult } from './sms-provider.interface.js';

/**
 * Non-production SMS stub: never sends a real message, never requires
 * live Twilio credentials. Same shape as DevOtpProvider (CP2) -- logs
 * what would have been sent and returns a fake provider id so the
 * claim-then-send path has something real to record.
 */
@Injectable()
export class DevSmsProvider implements SmsProvider {
  private readonly logger = new Logger(DevSmsProvider.name);

  async send(to: string, body: string): Promise<SmsSendResult> {
    const providerMessageId = `dev-${randomUUID()}`;
    this.logger.log(`[dev-sms] to ${to}: ${body} (not sent — SMS_PROVIDER=dev, id=${providerMessageId})`);
    return { providerMessageId };
  }
}
