"use server";

import { revalidatePath } from "next/cache";
import type { ReassignTableRejectionBody, ReassignTableResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";

export interface ReassignResult {
  ok: boolean;
  message?: string;
}

/**
 * CP7 — manual table reassignment. The concurrency safety lives in the
 * API (TableReassignmentService's atomic conditional claim and release);
 * this action's only job is to relay the staff session's authority and
 * turn a rejection into something a host can act on mid-service, rather
 * than a raw reason code.
 */
export async function reassignTableAction(visitId: string, newTableId: string): Promise<ReassignResult> {
  const session = await requireStaffSession();

  try {
    await apiFetch<ReassignTableResponse>(
      `/restaurants/${session.restaurantId}/dashboard/visits/${visitId}/reassign-table`,
      session.token,
      { method: "POST", body: JSON.stringify({ newTableId }) },
    );
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as Partial<ReassignTableRejectionBody> | undefined;
      switch (body?.reason) {
        case "table_taken":
          return { ok: false, message: "Someone just took that table. Pick another." };
        case "visit_not_active":
          return { ok: false, message: "That booking is no longer active." };
        case "table_not_found":
          return { ok: false, message: "That table no longer exists." };
        case "stale_update":
          return { ok: false, message: "This booking changed while you were looking. Refreshing." };
        default:
          return { ok: false, message: body?.message ?? "Couldn't move that booking." };
      }
    }
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }
}
