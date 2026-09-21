/**
 * CP10 — one function, used by the API, the staff app and the customer
 * app, for turning an instant into a wall-clock time a human reads.
 *
 * It exists because CP10 rendered the product in a browser and found
 * three different answers to the same question:
 *   - the dashboard and kitchen display formatted in the BROWSER's
 *     timezone (`toLocaleTimeString([])`),
 *   - the booking-confirmation SMS formatted in UTC
 *     (`toISOString().slice(11, 16)`) — a guest booked for 8:15 PM
 *     received a text saying 14:45,
 *   - and `Restaurant.timezone` — a column that has existed since CP1 —
 *     was read by nothing at all.
 *
 * Every e2e test seeds `timezone: 'UTC'` while the dev machine runs in
 * another zone, which is precisely why a green suite said nothing about
 * any of this.
 *
 * The restaurant's timezone is the right one everywhere, including for
 * the guest. "Arriving 8:15" is a promise about the restaurant's clock;
 * a traveller whose phone is still on another zone must not be told a
 * different number than the host is looking at.
 *
 * Deterministic on purpose. `toLocaleTimeString` is not: Node's ICU
 * rendered `07:00 pm` where the browser rendered `07:00 PM`, which React
 * reported as a hydration mismatch on the one screen whose entire job is
 * times. Fixing the locale, the hour cycle and the case — and
 * normalising the narrow no-break space ICU versions disagree about —
 * makes the server and the browser produce the same string.
 */
const EM_DASH = "—";

export function formatClockTime(instant: string | Date | null | undefined, timeZone: string): string {
  if (!instant) return EM_DASH;
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return EM_DASH;

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(date)
      .replace(/[\u202f\u00a0]/g, " ")
      .toUpperCase();
  } catch {
    // An invalid IANA zone must not blank out a screen that staff are
    // using to run a service. Fall back to UTC and say so, rather than
    // rendering a wrong local time that looks right.
    return `${new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(date)
      .replace(/[\u202f\u00a0]/g, " ")
      .toUpperCase()} UTC`;
  }
}
