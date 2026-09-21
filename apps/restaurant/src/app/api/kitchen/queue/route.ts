import type { KitchenQueueResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";

/** CP8 — the resync read behind the kitchen display's live feed. Same rule as everywhere: the staff JWT is attached here, server-side. */
export async function GET() {
  const session = await requireStaffSession();
  try {
    const body = await apiFetch<KitchenQueueResponse>(
      `/restaurants/${session.restaurantId}/kitchen/queue`,
      session.token,
    );
    return Response.json(body);
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Couldn't refresh the kitchen queue." }, { status: 502 });
  }
}
