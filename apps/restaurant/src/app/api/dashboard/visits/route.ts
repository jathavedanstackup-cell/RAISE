import type { DashboardListResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";

/**
 * CP7 — the resync read behind the live feed. The WebSocket carries no
 * backlog, so after any gap (reconnect, or an event this client can't
 * resolve from its own state) the only honest recovery is a fresh read.
 * Same rule as everywhere else in this app: the staff JWT is attached
 * here, server-side, and never reaches the browser.
 */
export async function GET() {
  const session = await requireStaffSession();
  try {
    const body = await apiFetch<DashboardListResponse>(
      `/restaurants/${session.restaurantId}/dashboard/visits`,
      session.token,
    );
    return Response.json(body);
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Couldn't refresh the dashboard." }, { status: 502 });
  }
}
