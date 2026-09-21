"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ConfirmedVisitDto,
  ConfirmRejectionBody,
  ConfirmVisitResponse,
  VisitDraftDto,
} from "@raise/shared-types";

interface ConfirmPanelProps {
  restaurantId: string;
  visitId: string;
  draftToken: string;
  draft: VisitDraftDto;
  onConfirmed: (visit: ConfirmedVisitDto) => void;
}

/**
 * CP5 — the explicit confirmation trust boundary (see docs/decisions.md
 * and docs/checkpoints/CP05-confirmation-booking.md). Renders ONLY once
 * the draft has everything a booking needs (party size, arrival time, a
 * proposed table) — the same completeness the backend itself requires,
 * so the guest never sees a confirm control before there's anything real
 * to confirm.
 *
 * Order matters here and is enforced by layout, not just convention: the
 * full read-back renders first, unconditionally, before any phone or
 * confirm control exists in the DOM at all — "the guest sees a complete
 * read-back first... before any confirm control is offered" is a literal
 * requirement, not a suggestion. Phone verification (reusing CP2's real
 * OTP endpoints, unchanged) gates the Confirm button — the single most
 * consequential control in the product, so it's full-width, high-contrast,
 * and never inferred from anything but its own explicit click/Enter.
 */
export function ConfirmPanel({
  restaurantId,
  visitId,
  draftToken,
  draft,
  onConfirmed,
}: ConfirmPanelProps) {
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [customerToken, setCustomerToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * CP10 fixed both halves of the same problem here. Each step of this
   * flow unmounts the button that was just pressed ("Send code" becomes
   * a code field; "Verify" becomes the confirm button), which dropped
   * focus to <body> every time, and nothing announced that a code had
   * been sent or that the phone was verified. A keyboard or
   * screen-reader user pressed a button and then had neither focus nor
   * information. Found by pressing the buttons, not by axe -- no
   * automated checker sees a step change.
   */
  const otpRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Derived, not stored: the announcement IS the step, so there is nothing
  // to keep in sync and no setState-inside-an-effect for the React compiler
  // to object to (the same lint that shaped CP7's socket hook).
  const status = customerToken
    ? "Phone verified. You can confirm your booking now."
    : otpSent
      ? "We've sent a code to your phone. Enter it below."
      : "";

  // Effects here do one thing only: move focus to whatever replaced the
  // control the guest just pressed.
  useEffect(() => {
    if (otpSent && !customerToken) otpRef.current?.focus();
  }, [otpSent, customerToken]);

  useEffect(() => {
    if (customerToken) confirmRef.current?.focus();
  }, [customerToken]);

  const ready =
    draft.partySize !== null &&
    draft.arrivalEta !== null &&
    draft.tableProposal !== null;
  if (!ready) return null;

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/customer/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (!res.ok)
        throw new Error(
          "Couldn't send a code to that number — check it and try again.",
        );
      setOtpSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't send a code to that number.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!otpCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/customer/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: otpCode.trim() }),
      });
      const body = (await res.json()) as { token?: string; message?: string };
      if (!res.ok || !body.token)
        throw new Error(
          body.message ?? "That code didn't match — check it and try again.",
        );
      setCustomerToken(body.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't match.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBooking() {
    if (!customerToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/visits/${visitId}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${draftToken}`,
          "X-Customer-Token": customerToken,
        },
        body: JSON.stringify({ restaurantId }),
      });
      const body = (await res.json()) as Partial<ConfirmVisitResponse> &
        Partial<ConfirmRejectionBody>;
      if (!res.ok)
        throw new Error(
          body.message ?? "Something went wrong confirming your booking.",
        );
      if (body.visit) onConfirmed(body.visit);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong confirming your booking.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="confirm-heading"
      className="flex flex-col gap-4 rounded-lg border-2 border-zinc-400 p-4 dark:border-zinc-500"
    >
      <h2 id="confirm-heading" className="text-lg font-semibold">
        Review your visit
      </h2>

      {/* The read-back — always here, always first, never behind the confirm control. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-medium">Party size</dt>
        <dd>{draft.partySize}</dd>
        <dt className="font-medium">Arrival</dt>
        <dd>
          {new Date(draft.arrivalEta!).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </dd>
        <dt className="font-medium">Table</dt>
        <dd>{draft.tableProposal!.label}</dd>
      </dl>
      <div>
        <h3 className="text-sm font-medium">Order</h3>
        {draft.items.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing ordered yet.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {draft.items.map((item) => (
              <li key={item.id}>
                {item.quantity}x {item.name}
                {item.modifications.length > 0 && (
                  <span> ({item.modifications.join(", ")})</span>
                )}
                {item.allergyFlags.length > 0 && (
                  <span className="font-medium">
                    {" "}
                    — {item.allergyFlags.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {!customerToken ? (
        <div className="flex flex-col gap-3 border-t border-zinc-300 pt-4 dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            We&apos;ll text a code to confirm it&apos;s really you before this
            is booked.
          </p>
          <form
            onSubmit={otpSent ? verifyCode : sendCode}
            className="flex flex-col gap-2"
          >
            <label htmlFor="confirm-phone" className="text-sm font-medium">
              Phone number
            </label>
            <div className="flex gap-2">
              <input
                id="confirm-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={busy || otpSent}
                placeholder="+1 555 555 0100"
                className="min-h-11 flex-1 rounded-lg border border-zinc-400 px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-900"
              />
              {!otpSent && (
                <button
                  type="submit"
                  disabled={busy || !phone.trim()}
                  className="min-h-11 rounded-lg bg-black px-4 py-2 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  Send code
                </button>
              )}
            </div>

            {otpSent && (
              <>
                <label htmlFor="confirm-otp" className="text-sm font-medium">
                  Verification code
                </label>
                <div className="flex gap-2">
                  <input
                    ref={otpRef}
                    id="confirm-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                    disabled={busy}
                    placeholder="123456"
                    className="min-h-11 flex-1 rounded-lg border border-zinc-400 px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-900"
                  />
                  <button
                    type="submit"
                    disabled={busy || !otpCode.trim()}
                    className="min-h-11 rounded-lg bg-black px-4 py-2 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    Verify
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-zinc-300 pt-4 dark:border-zinc-700">
          <p className="text-sm text-green-700 dark:text-green-400">
            ✓ Phone verified
          </p>
          {/* The single most consequential control in the product — full-width, high-contrast, and the only path that can ever book this table. */}
          <button
            ref={confirmRef}
            type="button"
            onClick={confirmBooking}
            disabled={busy}
            className="min-h-12 w-full rounded-lg bg-black px-4 py-3 text-base font-semibold text-white focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-orange-400 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {busy ? "Confirming…" : "Confirm booking"}
          </button>
        </div>
      )}
    </section>
  );
}
