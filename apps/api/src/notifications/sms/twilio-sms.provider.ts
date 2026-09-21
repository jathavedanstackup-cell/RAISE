import { Injectable } from '@nestjs/common';
import twilio from 'twilio';
import { requireEnv } from '../../auth/env.util.js';
import type { SmsProvider, SmsSendResult } from './sms-provider.interface.js';

/**
 * Real SMS delivery via the Messaging API (client.messages.create), not
 * Verify -- Verify is for OTP challenges (CP2), this is a one-off
 * transactional send. A raw `from` number, not a Messaging Service: this
 * project has no production Twilio infra (sender pools, A2P 10DLC
 * registration) set up, and reaching for one now would be scope beyond
 * what "send a confirmation text" needs. See docs/decisions.md.
 *
 * `messages.create` resolving only means Twilio ACCEPTED the message for
 * delivery (status "queued"/"sent"), not that it reached the phone --
 * actual delivery is only confirmed asynchronously via status callbacks,
 * which this checkpoint does not build (out of scope; "done when" is
 * about idempotent sending, not delivery tracking). NotificationLog's
 * "sent" status means "Twilio accepted it," documented as such.
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly client: ReturnType<typeof twilio>;
  private readonly fromNumber: string;

  constructor() {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    this.fromNumber = requireEnv('TWILIO_SMS_FROM_NUMBER');
    this.client = twilio(accountSid, authToken);
  }

  async send(to: string, body: string): Promise<SmsSendResult> {
    const message = await this.client.messages.create({ from: this.fromNumber, to, body });
    return { providerMessageId: message.sid };
  }
}
