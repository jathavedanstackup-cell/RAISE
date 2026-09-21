import Link from "next/link";
import type { KitchenQueueResponse } from "@raise/shared-types";
import { apiFetch } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";
import { KitchenLive } from "@/components/kitchen-live";
import { logoutAction } from "../menu/actions";

/**
 * CP8 — the kitchen display. Server-rendered first paint from a normal
 * authenticated read, then kept live over the WebSocket CP7 established.
 */
export default async function KitchenPage() {
  const session = await requireStaffSession();
  const body = await apiFetch<KitchenQueueResponse>(
    `/restaurants/${session.restaurantId}/kitchen/queue`,
    session.token,
  );

  const canAct = session.role === "kitchen" || session.role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Kitchen</h1>
          <p className="mt-1 text-sm text-text-muted">{session.restaurantName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            Front of house
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

      <KitchenLive initialTickets={body.tickets} canAct={canAct} />
    </div>
  );
}
