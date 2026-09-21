"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  formatClockTime,
  type DashboardVisitDto,
  type DashboardTableSummaryDto,
} from "@raise/shared-types";
import {
  applyDashboardEvent,
  parseDashboardEvent,
} from "@/lib/dashboard-events";
import {
  useDashboardSocket,
  type SocketState,
} from "@/lib/use-dashboard-socket";
import { reassignTableAction } from "@/app/dashboard/actions";
import { AllergenChips } from "@/components/allergen-fields";

interface Props {
  initialVisits: DashboardVisitDto[];
  tables: DashboardTableSummaryDto[];
  canReassign: boolean;
  /** The RESTAURANT's IANA zone, from the API — never the browser's. See CP10 in docs/decisions.md. */
  timezone: string;
}

const STATUS_LABELS: Record<DashboardVisitDto["status"], string> = {
  confirmed: "Confirmed",
  kitchen_started: "In the pass",
  table_set: "Table set",
  guest_arrived: "Arrived",
  food_out: "Food out",
};

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
    <p
      role="status"
      aria-live="polite"
      className={`rounded-md border px-4 py-2 text-sm ${tone}`}
    >
      {text}
    </p>
  );
}

export function DashboardLive({
  initialVisits,
  tables,
  canReassign,
  timezone,
}: Props) {
  const [visits, setVisits] = useState(initialVisits);
  const [notice, setNotice] = useState<string | null>(null);
  // What changed since the last render, said out loud. CP10: the
  // pre-build accessibility audit called this out by name (item #4) --
  // "a visually-obvious new highlighted row is invisible to a
  // screen-reader user unless the update is announced" -- and CP7
  // shipped without it. A host using a screen reader had no way to know
  // a booking had arrived.
  const [announcement, setAnnouncement] = useState("");
  const knownVisitIds = useRef(new Set(initialVisits.map((visit) => visit.id)));
  const [, startTransition] = useTransition();

  const clockTime = useCallback(
    (iso: string | null) => formatClockTime(iso, timezone),
    [timezone],
  );

  /**
   * Announces only what is genuinely new. A live region that re-reads the
   * whole list on every refetch is worse than none -- a host would learn
   * to tune it out, and then miss the one arrival that mattered.
   */
  const announceNewArrivals = useCallback(
    (next: DashboardVisitDto[]) => {
      const arrivals = next.filter(
        (visit) => !knownVisitIds.current.has(visit.id),
      );
      knownVisitIds.current = new Set(next.map((visit) => visit.id));
      if (arrivals.length === 0) return;
      setAnnouncement(
        arrivals.length === 1
          ? `New booking: table ${arrivals[0]!.table.label}, ${arrivals[0]!.partySize} ${arrivals[0]!.partySize === 1 ? "guest" : "guests"}, arriving ${clockTime(arrivals[0]!.arrivalEta)}.`
          : `${arrivals.length} new bookings.`,
      );
    },
    [clockTime],
  );

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
      announceNewArrivals(body.visits);
      setVisits(body.visits);
    } catch {
      // The connection banner already tells the host we're not live;
      // a failed background refetch needs no second alarm.
    }
  }, [announceNewArrivals]);

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
      if (!result.ok)
        setNotice(result.message ?? "Couldn't move that booking.");
      await resync();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ConnectionBanner state={socket} />
      {/* Visually hidden, deliberately: the new row is already obvious on
          screen. This is the same information for someone who can't see it. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      {notice ? (
        <p
          role="alert"
          className="rounded-md border border-danger px-4 py-2 text-sm text-danger"
        >
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
                  <span className="font-medium text-foreground">
                    Table {visit.table.label}
                  </span>
                  <span className="text-sm text-text-muted">
                    {visit.partySize}{" "}
                    {visit.partySize === 1 ? "guest" : "guests"}
                  </span>
                </div>
                <span className="rounded-full border border-border-default px-2 py-0.5 text-xs font-medium text-text-muted">
                  {STATUS_LABELS[visit.status]}
                </span>
              </div>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-text-muted">Kitchen start</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {clockTime(visit.kitchenStartTarget)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-text-muted">Food out</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {clockTime(visit.foodOutTarget)}
                  </dd>
                </div>
              </dl>

              {visit.items.length > 0 ? (
                <p className="text-sm text-text-muted">
                  {visit.items
                    .map((item) => `${item.quantity}× ${item.name}`)
                    .join(", ")}
                </p>
              ) : null}

              {allergensFor(visit).length > 0 ? (
                <div className="flex items-center gap-2">
                  {/* Allergies are the one thing on this screen that can hurt someone, so they get
                      their own row and the high-contrast chip treatment rather than being folded
                      into the order line. */}
                  <span className="text-sm font-medium text-foreground">
                    Allergies
                  </span>
                  <AllergenChips allergens={allergensFor(visit)} />
                </div>
              ) : null}

              {canReassign ? (
                /* CP10: this used to move the booking from the select's own
                   onChange. Keyboard users change a <select>'s value just by
                   arrowing through it, so arrowing past "T2" on the way to "T7"
                   moved a real party to the wrong table (WCAG 3.2.2, On Input).
                   The choice and the action are now separate. */
                <form
                  className="flex items-center gap-2 text-sm"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const newTableId = String(data.get("newTableId") ?? "");
                    if (newTableId) onReassign(visit.id, newTableId);
                    event.currentTarget.reset();
                  }}
                >
                  <label
                    className="flex items-center gap-2"
                    htmlFor={`move-${visit.id}`}
                  >
                    <span className="text-text-muted">Move to</span>
                  </label>
                  <select
                    id={`move-${visit.id}`}
                    name="newTableId"
                    aria-label={`Move the ${clockTime(visit.arrivalEta)} booking to a different table`}
                    defaultValue=""
                    className="rounded-md border border-border-default bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">Choose a table…</option>
                    {tables
                      .filter((table) => table.id !== visit.table.id)
                      .map((table) => (
                        <option
                          key={table.id}
                          value={table.id}
                          disabled={table.status !== "free"}
                        >
                          {table.label} ({table.seatsMin}–{table.seatsMax})
                          {table.status === "free" ? "" : ` — ${table.status}`}
                        </option>
                      ))}
                  </select>
                  <button
                    type="submit"
                    className="min-h-9 rounded-md border border-border-default px-3 py-1 text-sm font-medium text-foreground transition hover:bg-surface-muted"
                  >
                    Move
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
