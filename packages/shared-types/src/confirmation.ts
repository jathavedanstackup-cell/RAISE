/**
 * CP5 — the explicit confirmation trust boundary (see docs/decisions.md
 * and docs/checkpoints/CP05-confirmation-booking.md). Shared between
 * apps/api and apps/customer so the confirm response/rejection shape is
 * defined once.
 */
import type { VisitItemDto } from "./intake.js";

export interface ConfirmedTableDto {
  id: string;
  label: string;
}

/** The booking once confirmed. `status` is narrowed to "confirmed" — CP5 is the only place this shape is ever produced. */
export interface ConfirmedVisitDto {
  id: string;
  restaurantId: string;
  status: "confirmed";
  partySize: number;
  arrivalEta: string;
  arrivalConfirmedAt: string;
  table: ConfirmedTableDto;
  items: VisitItemDto[];
}

export interface ConfirmVisitResponse {
  visit: ConfirmedVisitDto;
  /** True when this exact visit was already confirmed by an earlier call (double-tap, retry, replay) — same booking, not a new one. See docs/decisions.md's idempotency entry. */
  alreadyConfirmed: boolean;
}

/**
 * Every way a confirm attempt can be honestly refused. Each has a defined
 * behavior and a test — see docs/decisions.md's unhappy-paths table.
 */
export type ConfirmRejectionReason =
  | "not_draft"
  | "identity_mismatch"
  | "missing_party_size"
  | "missing_arrival_eta"
  | "missing_table"
  | "table_taken"
  | "items_unavailable";

export interface ConfirmRejectionBody {
  message: string;
  reason: ConfirmRejectionReason;
  /** Populated only when reason is "items_unavailable" — which lines the guest needs to fix before trying again. */
  unavailableItems?: { visitItemId: string; name: string }[];
}
