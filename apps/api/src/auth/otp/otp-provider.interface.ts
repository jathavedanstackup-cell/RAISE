/**
 * Phone OTP is one of the three primitives this checkpoint calls out as
 * "don't hand-roll" (alongside password hashing and JWT issuance) — see
 * docs/decisions.md for why Twilio Verify is the real-provider choice.
 * This interface lets the dev/CI stub and the real provider be swapped by
 * env var alone (OTP_PROVIDER), so local work and CI never touch Twilio or
 * burn SMS credits.
 */
export interface OtpProvider {
  /** Sends (or, for the dev stub, logs) a one-time code to `phone`. */
  sendCode(phone: string): Promise<void>;
  /** Returns whether `code` is currently valid for `phone`. */
  verifyCode(phone: string, code: string): Promise<boolean>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');
