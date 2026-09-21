import type { DashboardVisitDto } from "@raise/shared-types";

/**
 * CP7 — the shape VisitsGateway sends on the wire. Kept here rather than
 * in @raise/shared-types because the gateway builds these payloads by
 * hand; if a later checkpoint types them at the source, this should move
 * there so the two can never drift silently.
 */
export type DashboardSocketEvent =
  | { event: "visit.confirmed"; data: { visitId: string } }
  | { event: "visit.table_reassigned"; data: { visitId: string; previousTableId: string; newTableId: string } }
  | { event: "visit.timing.recomputed"; data: { visitId: string; kitchenStartTarget: string; foodOutTarget: string } }
  | { event: "visit.kitchen.accepted"; data: { visitId: string; acceptedAt: string } };

/**
 * Applies one event to the current list. Events that can't be resolved
 * from their own payload alone -- a brand-new confirmed visit, or a
 * reassignment whose table label this client has never seen -- return
 * null, which the caller treats as "refetch", never as "guess". A
 * dashboard that invents a table label during service is worse than one
 * that takes another round trip.
 */
export function applyDashboardEvent(
  visits: DashboardVisitDto[],
  message: DashboardSocketEvent,
): DashboardVisitDto[] | null {
  switch (message.event) {
    case "visit.confirmed":
      // A visit this client has never seen: no amount of local state can
      // synthesise its party size, items or table. Refetch.
      return visits.some((visit) => visit.id === message.data.visitId) ? visits : null;

    case "visit.timing.recomputed": {
      const index = visits.findIndex((visit) => visit.id === message.data.visitId);
      if (index === -1) return null;
      const next = [...visits];
      next[index] = {
        ...next[index]!,
        kitchenStartTarget: message.data.kitchenStartTarget,
        foodOutTarget: message.data.foodOutTarget,
      };
      return next;
    }

    case "visit.kitchen.accepted": {
      const index = visits.findIndex((visit) => visit.id === message.data.visitId);
      if (index === -1) return null;
      const next = [...visits];
      next[index] = { ...next[index]!, status: "kitchen_started" };
      return next;
    }

    case "visit.table_reassigned":
      // The payload carries table ids, not labels. Refetch rather than
      // render an id, or worse, a stale label.
      return null;

    default:
      return null;
  }
}

/** Narrows an untrusted wire payload. Anything unrecognised is dropped, never coerced. */
export function parseDashboardEvent(raw: unknown): DashboardSocketEvent | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { event?: unknown; data?: unknown };
  if (typeof candidate.event !== "string") return null;
  if (typeof candidate.data !== "object" || candidate.data === null) return null;
  const known = ["visit.confirmed", "visit.table_reassigned", "visit.timing.recomputed", "visit.kitchen.accepted"];
  if (!known.includes(candidate.event)) return null;
  return parsed as DashboardSocketEvent;
}
