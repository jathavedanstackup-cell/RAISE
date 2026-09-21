"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { formatClockTime, type KitchenTicketDto } from "@raise/shared-types";
import {
  useDashboardSocket,
  type SocketState,
} from "@/lib/use-dashboard-socket";
import {
  acknowledgeAllergiesAction,
  markFoodOutAction,
} from "@/app/kitchen/actions";
import { AllergenChips } from "@/components/allergen-fields";

interface Props {
  initialTickets: KitchenTicketDto[];
  canAct: boolean;
  /** The RESTAURANT's IANA zone, from the API — never the browser's. See CP10 in docs/decisions.md. */
  timezone: string;
}

function ConnectionBanner({ state }: { state: SocketState }) {
  if (state.status === "live") return null;
  const text =
    state.status === "connecting"
      ? "Connecting…"
      : state.status === "reconnecting"
        ? "Reconnecting — this queue may be out of date."
        : state.reason;
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-md border border-border-default px-4 py-3 text-base text-text-muted"
    >
      {text}
    </p>
  );
}

/**
 * CP8 — the pass screen.
 *
 * Read at distance, at speed, by someone holding a pan. So: large type,
 * tabular times, one ticket per row, and no information that needs a
 * second look to decode.
 *
 * The allergy treatment is fixed by docs/decisions.md's CP8 entry and is
 * not a styling choice to revisit casually:
 *  - the flags render identically before and after acknowledgment. There
 *    is deliberately no branch anywhere in this file on
 *    `allergyAcknowledgedAt` that changes what is shown.
 *  - they do not rely on colour alone: a bordered block, the literal word
 *    ALLERGY, and the chips together. A sun-washed pass screen and a
 *    colour-blind cook are ordinary conditions, not edge cases.
 *  - they do not share the accent used for priority/next, which the
 *    concept deck reused for both (see docs/concept-critique.md).
 */
export function KitchenLive({ initialTickets, canAct, timezone }: Props) {
  const [tickets, setTickets] = useState(initialTickets);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const knownTicketIds = useRef(
    new Set(initialTickets.map((ticket) => ticket.visitId)),
  );
  const [, startTransition] = useTransition();

  const clockTime = useCallback(
    (iso: string | null) => formatClockTime(iso, timezone),
    [timezone],
  );

  /**
   * CP10. A ticket arriving on the pass was a purely visual event; this
   * says it. Allergy flags are named in the announcement on purpose --
   * it is the one thing on this screen that can hurt someone, and a
   * cook who can't see the screen needs it in the first sentence, not
   * after they've walked over.
   */
  const announceNewTickets = useCallback(
    (next: KitchenTicketDto[]) => {
      const arrivals = next.filter(
        (ticket) => !knownTicketIds.current.has(ticket.visitId),
      );
      knownTicketIds.current = new Set(next.map((ticket) => ticket.visitId));
      if (arrivals.length === 0) return;
      setAnnouncement(
        arrivals
          .map(
            (ticket) =>
              `New ticket, table ${ticket.tableLabel}, start ${clockTime(ticket.kitchenStartTarget)}.` +
              (ticket.allergyFlags.length > 0
                ? ` Allergy: ${ticket.allergyFlags.join(", ")}.`
                : ""),
          )
          .join(" "),
      );
    },
    [clockTime],
  );

  const resync = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen/queue");
      if (!res.ok) return;
      const body = (await res.json()) as { tickets: KitchenTicketDto[] };
      announceNewTickets(body.tickets);
      setTickets(body.tickets);
    } catch {
      // The banner already reports that we aren't live.
    }
  }, [announceNewTickets]);

  // Every kitchen event changes queue membership or ticket state, and none
  // of them carry enough to rebuild a ticket locally. Refetch rather than
  // guess — the same rule CP7's dashboard follows.
  const onMessage = useCallback(() => void resync(), [resync]);
  const socket = useDashboardSocket({ onMessage, onResync: resync });

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setNotice(result.message ?? "That didn't work.");
      await resync();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ConnectionBanner state={socket} />
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      {notice ? (
        <p
          role="alert"
          className="rounded-md border-2 border-danger px-4 py-3 text-base font-medium text-danger"
        >
          {notice}
        </p>
      ) : null}

      {tickets.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default px-4 py-10 text-center text-base text-text-muted">
          Nothing due yet. Tickets appear at their computed start time.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((ticket) => (
            <li
              key={ticket.visitId}
              className="rounded-lg border-2 border-border-default p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-4">
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {clockTime(ticket.kitchenStartTarget)}
                  </span>
                  <span className="text-xl font-semibold text-foreground">
                    Table {ticket.tableLabel}
                  </span>
                  <span className="text-base text-text-muted">
                    {ticket.partySize}{" "}
                    {ticket.partySize === 1 ? "guest" : "guests"}
                  </span>
                </div>
                <span className="text-base text-text-muted">
                  Food out{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {clockTime(ticket.foodOutTarget)}
                  </span>
                </span>
              </div>

              {ticket.allergyFlags.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border-2 border-foreground bg-surface-muted px-4 py-3">
                  <span className="text-base font-bold uppercase tracking-wide text-foreground">
                    Allergy
                  </span>
                  <AllergenChips allergens={ticket.allergyFlags} />
                  {ticket.allergyAcknowledgedAt ? (
                    <span className="text-sm text-text-muted">
                      Seen by kitchen at{" "}
                      {clockTime(ticket.allergyAcknowledgedAt)}
                    </span>
                  ) : canAct ? (
                    <button
                      type="button"
                      onClick={() =>
                        run(() => acknowledgeAllergiesAction(ticket.visitId))
                      }
                      className="rounded-md border-2 border-foreground px-4 py-2 text-base font-semibold text-foreground transition hover:bg-background"
                    >
                      I&apos;ve seen this
                    </button>
                  ) : null}
                </div>
              ) : null}

              <ul className="mt-4 flex flex-col gap-1">
                {ticket.items.map((item) => (
                  <li key={item.id} className="text-lg text-foreground">
                    <span className="font-semibold tabular-nums">
                      {item.quantity}×
                    </span>{" "}
                    {item.name}
                    {item.modifications.length > 0 ? (
                      <span className="text-text-muted">
                        {" "}
                        — {item.modifications.join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>

              {canAct ? (
                <div className="mt-4">
                  {/* CP10: this was a real `disabled` button, which is not
                      focusable -- so a keyboard or screen-reader user could
                      never reach it and never heard the "accept the prep
                      prompt first" text sitting next to it. aria-disabled
                      keeps it in the tab order and tied to its own reason. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (ticket.status !== "kitchen_started") return;
                      run(() => markFoodOutAction(ticket.visitId));
                    }}
                    aria-disabled={ticket.status !== "kitchen_started"}
                    aria-describedby={
                      ticket.status !== "kitchen_started"
                        ? `food-out-why-${ticket.visitId}`
                        : undefined
                    }
                    className="rounded-md bg-zinc-900 px-5 py-2.5 text-base font-semibold text-white transition hover:bg-zinc-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-zinc-900"
                  >
                    Food out
                  </button>
                  {ticket.status !== "kitchen_started" ? (
                    <span
                      id={`food-out-why-${ticket.visitId}`}
                      className="ml-3 text-sm text-text-muted"
                    >
                      Accept the prep prompt first.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
