import { Module } from '@nestjs/common';
import { TimingModule } from '../timing/timing.module.js';
import { NotificationService } from './notification.service.js';
import { NotificationSubscriber } from './notification.subscriber.js';
import { SMS_PROVIDER } from './sms/sms-provider.interface.js';
import { DevSmsProvider } from './sms/dev-sms.provider.js';
import { TwilioSmsProvider } from './sms/twilio-sms.provider.js';

/**
 * CP9. Imports TimingModule purely for its exported CLOCK — one clock
 * per process is what lets a test control `sentAt` (CP6 exported it for
 * exactly this reason; CP8 was the first consumer).
 *
 * No controller: nothing about notifications is client-triggerable.
 * Every send originates from a domain event the server itself emitted,
 * which is a deliberate trust boundary — an HTTP endpoint that says
 * "send the confirmation for visit X" would be an SMS-amplification
 * primitive pointed at a guest's phone, rate-limited or not.
 */
@Module({
  imports: [TimingModule],
  providers: [
    NotificationService,
    NotificationSubscriber,
    {
      provide: SMS_PROVIDER,
      // Defaults to the dev stub — SMS_PROVIDER=twilio must be set
      // explicitly, and requires TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
      // TWILIO_SMS_FROM_NUMBER. Same fail-safe default as CP4's
      // ASR_PROVIDER: the accident is a missing text in dev, never a real
      // text to a real phone from a test run.
      useClass: process.env.SMS_PROVIDER === 'twilio' ? TwilioSmsProvider : DevSmsProvider,
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
