import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";

interface MintTicketResponse {
  ticket: string;
  expiresInMs: number;
}

/**
 * CP7 — the browser's only way to authenticate a WebSocket. It calls this
 * same-origin route; this route (server-side) attaches the staff JWT from
 * the httpOnly cookie and asks apps/api to mint a short-lived, single-use
 * ticket. The browser receives the ticket and nothing else. See
 * docs/decisions.md's CP7 entry for why a ticket rather than the JWT: the
 * JWT is owner-privileged and 12h-lived, and a WebSocket URL or
 * subprotocol is far more exposed (proxy logs, devtools, extensions) than
 * a server-side Authorization header.
 *
 * Deliberately POST, not GET: minting is a state change (it adds a
 * consumable credential to the server's store), so it must not be
 * prefetched, cached, or triggered by a cross-site navigation.
 */
export async function POST() {
  const session = await requireStaffSession();

  try {
    const result = await apiFetch<MintTicketResponse>(
      `/restaurants/${session.restaurantId}/realtime/ticket`,
      session.token,
      { method: "POST" },
    );
    // The restaurantId goes back too so the client can label its own
    // state; it is NOT what scopes the socket. The gateway derives that
    // from the ticket it verifies, never from anything the client sends.
    return Response.json({ ...result, restaurantId: session.restaurantId });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Could not open a live connection." }, { status: 502 });
  }
}
