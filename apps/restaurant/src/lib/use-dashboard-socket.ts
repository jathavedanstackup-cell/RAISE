"use client";

import { useEffect, useRef, useState } from "react";

/** Matches VisitsGateway's close codes — see apps/api/src/realtime/visits.gateway.ts. */
const CLOSE_ORIGIN_NOT_ALLOWED = 4403;

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export type SocketState =
  | { status: "connecting" }
  | { status: "live" }
  /** Retrying: data on screen is stale and the UI must say so. */
  | { status: "reconnecting" }
  /** Terminal: retrying cannot help (misconfigured origin, or live updates aren't configured). */
  | { status: "stopped"; reason: string };

interface Options {
  onMessage: (raw: string) => void;
  /** Called whenever a fresh connection is established, so the caller can resync state it may have missed while disconnected. */
  onResync: () => void;
}

/**
 * CP7 — owns the whole ticket-exchange lifecycle for one dashboard.
 *
 * Every connection attempt mints a NEW ticket. Tickets are single-use and
 * ~20s-lived server-side, so a reconnect can never replay the old one;
 * caching one would just be a credential sitting in browser memory for no
 * benefit.
 *
 * A 4403 (origin not allowed) is terminal: it means this deployment is
 * misconfigured, and retrying would hammer the server forever without ever
 * succeeding. Everything else backs off exponentially with jitter.
 *
 * The whole connection machine lives inside one effect, with plain locals
 * rather than refs, so there is exactly one owner of the socket and the
 * cleanup function can see every handle it needs to tear down.
 */
export function useDashboardSocket({ onMessage, onResync }: Options): SocketState {
  const [state, setState] = useState<SocketState>({ status: "connecting" });

  const messageRef = useRef(onMessage);
  const resyncRef = useRef(onResync);

  // Written in an effect, never during render: the callers pass fresh
  // closures every render, and the socket effect must not be torn down
  // and rebuilt each time they change.
  useEffect(() => {
    messageRef.current = onMessage;
    resyncRef.current = onResync;
  }, [onMessage, onResync]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function scheduleRetry(): void {
      if (disposed) return;
      const backoff = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
      attempt += 1;
      // Jitter so a restarted API doesn't get every dashboard at once.
      const delay = backoff * (0.5 + Math.random() * 0.5);
      setState({ status: "reconnecting" });
      timer = setTimeout(() => void connect(), delay);
    }

    async function connect(): Promise<void> {
      if (disposed) return;

      const wsUrl = process.env.NEXT_PUBLIC_API_WS_URL;
      if (!wsUrl) {
        setState({ status: "stopped", reason: "Live updates aren't configured for this environment." });
        return;
      }

      let ticket: string;
      try {
        const res = await fetch("/api/realtime/ticket", { method: "POST" });
        if (!res.ok) throw new Error(`ticket request failed: ${res.status}`);
        ({ ticket } = (await res.json()) as { ticket: string });
      } catch {
        scheduleRetry();
        return;
      }

      if (disposed) return;

      // The ticket rides in Sec-WebSocket-Protocol, not the query string:
      // URLs land in proxy logs, browser history and Referer headers.
      const next = new WebSocket(wsUrl, [ticket]);
      socket = next;

      next.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setState({ status: "live" });
        // We may have missed events while disconnected; the socket carries
        // no backlog, so the only honest recovery is a fresh read.
        resyncRef.current();
      };

      next.onmessage = (event) => {
        if (typeof event.data === "string") messageRef.current(event.data);
      };

      next.onclose = (event) => {
        if (socket === next) socket = null;
        if (disposed) return;
        if (event.code === CLOSE_ORIGIN_NOT_ALLOWED) {
          setState({
            status: "stopped",
            reason: "The server refused this origin. Live updates are off until that's fixed.",
          });
          return;
        }
        scheduleRetry();
      };

      // onerror always precedes onclose in browsers; the close handler owns recovery.
      next.onerror = () => next.close();
    }

    void connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      socket = null;
    };
  }, []);

  return state;
}
