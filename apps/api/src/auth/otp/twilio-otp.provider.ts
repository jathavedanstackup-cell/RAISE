import { Injectable } from '@nestjs/common';
import twilio from 'twilio';
import { requireEnv } from '../env.util.js';
import type { OtpProvider } from './otp-provider.interface.js';

/**
 * Real OTP delivery via Twilio Verify (not the raw Messaging API): Verify
 * owns code generation, expiry, resend cooldowns, and brute-force/fraud
 * checks server-side, so none of that is hand-rolled here. See
 * docs/decisions.md.
 */
@Injectable()
export class TwilioOtpProvider implements OtpProvider {
  private readonly client: ReturnType<typeof twilio>;
  private readonly serviceSid: string;

  constructor() {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    this.serviceSid = requireEnv('TWILIO_VERIFY_SERVICE_SID');
    this.client = twilio(accountSid, authToken);
  }

  async sendCode(phone: string): Promise<void> {
    await this.client.verify.v2.services(this.serviceSid).verifications.create({
      to: phone,
      channel: 'sms',
    });
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    const result = await this.client.verify.v2.services(this.serviceSid).verificationChecks.create({
      to: phone,
      code,
    });
    return result.status === 'approved';
  }
}
