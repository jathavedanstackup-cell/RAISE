import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import type { OtpProvider } from './otp-provider.interface.js';

const CODE_TTL_MS = 5 * 60 * 1000;

/**
 * Non-production OTP stub: never sends a real SMS, never requires live
 * provider credentials. Codes live in-memory (fine — this is dev/CI only,
 * a single process, and never the provider used when OTP_PROVIDER=twilio).
 * Set OTP_DEV_FIXED_CODE for deterministic codes in automated tests;
 * otherwise a random 6-digit code is generated and logged.
 */
@Injectable()
export class DevOtpProvider implements OtpProvider {
  private readonly logger = new Logger(DevOtpProvider.name);
  private readonly challenges = new Map<string, { codeHash: string; expiresAt: number }>();

  async sendCode(phone: string): Promise<void> {
    const code = process.env.OTP_DEV_FIXED_CODE ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.challenges.set(phone, {
      codeHash: this.hash(code),
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    this.logger.log(`[dev-otp] code for ${phone}: ${code} (not sent — OTP_PROVIDER=dev)`);
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    const challenge = this.challenges.get(phone);
    if (!challenge || challenge.expiresAt < Date.now()) return false;
    const matches = challenge.codeHash === this.hash(code);
    if (matches) this.challenges.delete(phone);
    return matches;
  }

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
