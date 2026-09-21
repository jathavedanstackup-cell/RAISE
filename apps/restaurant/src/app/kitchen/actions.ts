"use server";

import type { AcknowledgeAllergyResponse, FoodOutRejectionBody, FoodOutResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";

export interface KitchenActionResult {
  ok: boolean;
  message?: string;
}

/**
 * CP8 — records that a human confirmed they saw the allergy flags.
 *
 * Note what this action does NOT do: it does not tell the UI to hide or
 * quieten anything. The only thing that changes is an audit timestamp.
 * See docs/decisions.md's CP8 entry.
 */
export async function acknowledgeAllergiesAction(visitId: string): Promise<KitchenActionResult> {
  const session = await requireStaffSession();
  try {
    await apiFetch<AcknowledgeAllergyResponse>(
      `/restaurants/${session.restaurantId}/kitchen/visits/${visitId}/allergy-ack`,
      session.token,
      { method: "POST" },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: "Couldn't record that. Try again." };
    return { ok: false, message: "Couldn't reach the server." };
  }
}

export async function markFoodOutAction(visitId: string): Promise<KitchenActionResult> {
  const session = await requireStaffSession();
  try {
    await apiFetch<FoodOutResponse>(
      `/restaurants/${session.restaurantId}/kitchen/visits/${visitId}/food-out`,
      session.token,
      { method: "POST" },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as Partial<FoodOutRejectionBody> | undefined;
      if (body?.reason === "allergy_not_acknowledged") {
        return { ok: false, message: "Confirm you've seen the allergy flags first." };
      }
      return { ok: false, message: body?.message ?? "Couldn't send that out." };
    }
    return { ok: false, message: "Couldn't reach the server." };
  }
}
