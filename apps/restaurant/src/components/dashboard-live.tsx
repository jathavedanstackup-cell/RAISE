"use client";

import { useCallback, useState, useTransition } from "react";
import type { DashboardVisitDto, DashboardTableSummaryDto } from "@raise/shared-types";
import { applyDashboardEvent, parseDashboardEvent } from "@/lib/dashboard-events";
import { useDashboardSocket, type SocketState } from "@/lib/use-dashboard-socket";
import { reassignTableAction } from "@/app/dashboard/actions";
import { AllergenChips } from "@/components/allergen-fields";

interface Props {
  initialVisits: DashboardVisitDto[];
  tables: DashboardTableSummaryDto[];
  canReassign: boolean;
}

const STATUS_LABELS: Record<DashboardVisitDto["status"], string> = {
  confirmed: "Confirmed",
  kitchen_started: "In the pass",
  table_set: "Table set",
  guest_arrived: "Arrived",
  food_out: "Food out",
};

/** Times are rendered in the browser's zone from the API's UTC instants — the same separation of arithmetic from formatting CP6's engine relies on. */
function clockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Every allergy flag across the whole order, de-duplicated -- a host needs the party's set, not a per-dish breakdown. */
function allergensFor(visit: DashboardVisitDto) {
  return [...new Set(visit.items.flatMap((item) => item.allergyFlags))];
}

function ConnectionBanner({ state }: { state: SocketState }) {
  if (state.status === "live") return null;

  const tone =
    state.status === "stopped"
      ? "border-danger text-danger"
      : "border-border-default text-text-muted";

  const text =
    state.status === "connecting"
      ? "Connecting to live updates…"
      : state.status === "reconnecting"
        ? "Reconnecting — the times below may be out of date."
        : state.reason;

  return (
    <p role="status" aria-live="polite" className={`rounded-md border px-4 py-2 text-sm ${tone}`}>
      {text}
    </p>
  );
}

export function DashboardLive({ initialVisits, tables, canReassign }: Props) {
  const [visits, setVisits] = useState(initialVisits);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Any event this client can't resolve from its own state -- a visit it
   * has never seen, a reassignment carrying table ids rather than labels
   * -- triggers a refetch instead of a guess. During service, a wrong
   * table number is worse than a half-second delay.
   */
  const resync = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/visits");
      if (!res.ok) return;
      const body = (await res.json()) as { visits: DashboardVisitDto[] };
      setVisits(body.visits);
    } catch {
      // The connection banner already tells the host we're not live;
      // a failed background refetch needs no second alarm.
    }
  }, []);

  const onMessage = useCallback(
    (raw: string) => {
      const message = parseDashboardEvent(raw);
      if (!message) return;
      setVisits((current) => {
        const next = applyDashboardEvent(current, message);
        if (next === null) {
          void resync();
          return current;
        }
        return next;
      });
    },
    [resync],
  );

  const socket = useDashboardSocket({ onMessage, onResync: resync });

  function onReassign(visitId: string, newTableId: string) {
    if (!newTableId) return;
    setNotice(null);
    startTransition(async () => {
      const result = await reassignTableAction(visitId, newTableId);
      if (!result.ok) setNotice(result.message ?? "Couldn't move that booking.");
      await resync();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ConnectionBanner state={socket} />
      {notice ? (
        <p role="alert" className="rounded-md border border-danger px-4 py-2 text-sm text-danger">
          {notice}
        </p>
      ) : null}

      {visits.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default px-4 py-8 text-center text-sm text-text-muted">
          Nothing inbound yet tonight.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default rounded-lg border border-border-default">
          {visits.map((visit) => (
            <li key={visit.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-lg font-semibold tabular-nums text-foreground">
                    {clockTime(visit.arrivalEta)}
                  </span>
                  <span className="font-medium text-foreground">Table {visit.table.label}</span>
                  <span className="text-sm text-text-muted">
                    {visit.partySize} {visit.partySize === 1 ? "guest" : "guests"}
                  </span>
                </div>
                <span className="rounded-full border border-border-default px-2 py-0.5 text-xs font-medium text-text-muted">
                  {STATUS_LABELS[visit.status]}
                </span>
              </div>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-text-muted">Kitchen start</dt>
                  <dd className="font-medium tabular-nums text-foreground">{clockTime(visit.kitchenStartTarget)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-text-muted">Food out</dt>
                  <dd className="font-medium tabular-nums text-foreground">{clockTime(visit.foodOutTarget)}</dd>
                </div>
              </dl>

              {visit.items.length > 0 ? (
                <p className="text-sm text-text-muted">
                  {visit.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}
                </p>
              ) : null}

              {allergensFor(visit).length > 0 ? (
                <div className="flex items-center gap-2">
                  {/* Allergies are the one thing on this screen that can hurt someone, so they get
                      their own row and the high-contrast chip treatment rather than being folded
                      into the order line. */}
                  <span className="text-sm font-medium text-foreground">Allergies</span>
                  <AllergenChips allergens={allergensFor(visit)} />
                </div>
              ) : null}

              {canReassign ? (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-text-muted">Move to</span>
                  <select
                    aria-label={`Move the ${clockTime(visit.arrivalEta)} booking to a different table`}
                    defaultValue=""
                    onChange={(event) => {
                      onReassign(visit.id, event.target.value);
                      event.target.value = "";
                    }}
                    className="rounded-md border border-border-default bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">Choose a table…</option>
                    {tables
                      .filter((table) => table.id !== visit.table.id)
                      .map((table) => (
                        <option key={table.id} value={table.id} disabled={table.status !== "free"}>
                          {table.label} ({table.seatsMin}–{table.seatsMax})
                          {table.status === "free" ? "" : ` — ${table.status}`}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
