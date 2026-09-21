/**
 * CP7 — the FOH "Tonight — Inbound" dashboard. Shared between apps/api
 * and apps/restaurant so the initial HTTP load and the live WebSocket
 * feed agree on shape. See docs/decisions.md's CP7 entry for the
 * realtime auth design these endpoints sit behind.
 */
import type { VisitItemDto } from "./intake.js";

/** The statuses "Tonight — Inbound" tracks — a visit leaves this list once it's food_out-and-beyond-complete, or never entered it (draft/cancelled/no_show). */
export type DashboardVisitStatus = "confirmed" | "kitchen_started" | "table_set" | "guest_arrived" | "food_out";

export interface DashboardTableDto {
  id: string;
  label: string;
}

export interface DashboardVisitDto {
  id: string;
  status: DashboardVisitStatus;
  partySize: number;
  arrivalEta: string;
  table: DashboardTableDto;
  items: VisitItemDto[];
  kitchenStartTarget: string | null;
  foodOutTarget: string | null;
}

export interface DashboardListResponse {
  visits: DashboardVisitDto[];
}

export type TableAvailabilityStatus = "free" | "held" | "seated";

export interface DashboardTableSummaryDto {
  id: string;
  label: string;
  seatsMin: number;
  seatsMax: number;
  status: TableAvailabilityStatus;
}

export interface DashboardTablesResponse {
  tables: DashboardTableSummaryDto[];
}

export interface ReassignTableRequest {
  newTableId: string;
}

export interface ReassignTableResponse {
  visitId: string;
  tableId: string;
  alreadyAssigned: boolean;
}

export type ReassignTableRejectionReason = "table_taken" | "visit_not_active" | "table_not_found" | "stale_update";

export interface ReassignTableRejectionBody {
  message: string;
  reason: ReassignTableRejectionReason;
}
