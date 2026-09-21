import Link from "next/link";
import type { DashboardListResponse, DashboardTablesResponse } from "@raise/shared-types";
import { apiFetch } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";
import { DashboardLive } from "@/components/dashboard-live";
import { logoutAction } from "../menu/actions";

/**
 * CP7 — "Tonight — Inbound". Server-rendered first paint from a normal
 * authenticated read, then handed to a client component that keeps it
 * live over the WebSocket. Rendering the first list on the server means
 * the screen is useful before any socket exists, and stays useful if one
 * never opens.
 */
export default async function DashboardPage() {
  const session = await requireStaffSession();

  const [visitsBody, tablesBody] = await Promise.all([
    apiFetch<DashboardListResponse>(`/restaurants/${session.restaurantId}/dashboard/visits`, session.token),
    apiFetch<DashboardTablesResponse>(`/restaurants/${session.restaurantId}/dashboard/tables`, session.token),
  ]);

  const canReassign = session.role === "foh" || session.role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Tonight — Inbound</h1>
          <p className="mt-1 text-sm text-text-muted">{session.restaurantName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/menu"
            className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            Menu
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      <DashboardLive
        initialVisits={visitsBody.visits}
        tables={tablesBody.tables}
        canReassign={canReassign}
      />
    </div>
  );
}
