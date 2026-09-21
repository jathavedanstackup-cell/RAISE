/**
 * CP8 — the kitchen display (KDS). Shared between apps/api and
 * apps/restaurant so the initial HTTP load and the live WebSocket feed
 * agree on shape.
 *
 * See docs/decisions.md, "Allergy flag: passive display vs. staff
 * acknowledgment": an allergy flag must be acknowledged before food_out,
 * and acknowledging it NEVER changes how it renders. That is why
 * `allergyFlags` and `allergyAcknowledgedAt` are separate fields with no
 * derived "show/hide" flag between them — there is deliberately nothing
 * in this contract a client could use to quieten a flag.
 */
import type { AllergenTag } from "./menu-item.js";

/** Statuses a ticket can hold while it is the kitchen's problem. */
export type KitchenTicketStatus = "confirmed" | "kitchen_started";

export interface KitchenTicketItemDto {
  id: string;
  name: string;
  quantity: number;
  modifications: string[];
  allergyFlags: AllergenTag[];
  prepTimeMinutes: number;
}

export interface KitchenTicketDto {
  visitId: string;
  status: KitchenTicketStatus;
  tableLabel: string;
  partySize: number;
  arrivalEta: string;
  kitchenStartTarget: string;
  foodOutTarget: string | null;
  items: KitchenTicketItemDto[];
  /** Every allergy flag across the order, de-duplicated. Empty means no flags. */
  allergyFlags: AllergenTag[];
  /** When a staff member confirmed they had seen the flags; null if not yet. Never controls rendering of the flags themselves. */
  allergyAcknowledgedAt: string | null;
}

export interface KitchenQueueResponse {
  tickets: KitchenTicketDto[];
  /** The restaurant's IANA timezone — see the note on DashboardListResponse. */
  timezone: string;
}

export interface AcknowledgeAllergyResponse {
  visitId: string;
  acknowledgedAt: string;
  alreadyAcknowledged: boolean;
}

export type FoodOutRejectionReason = "allergy_not_acknowledged" | "not_in_progress";

export interface FoodOutResponse {
  visitId: string;
  alreadyServed: boolean;
  servedAt?: string;
}

export interface FoodOutRejectionBody {
  message: string;
  reason: FoodOutRejectionReason;
}
