/**
 * CP9 — same "don't hand-roll" reasoning as CP2's OtpProvider: a single
 * interface, swapped by env var (SMS_PROVIDER), so local work and CI
 * never touch Twilio or burn SMS credits. See docs/decisions.md.
 */
export interface SmsSendResult {
  /** The provider's own message id (Twilio's `sid`), recorded in NotificationLog for support/debugging -- never used for correctness, see docs/decisions.md on why Twilio has no built-in idempotency key. */
  providerMessageId: string;
}

export interface SmsProvider {
  send(to: string, body: string): Promise<SmsSendResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
