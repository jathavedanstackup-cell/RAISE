import "server-only";

/**
 * Every call to apps/api goes through here, server-side only — the browser
 * only ever talks to this app's own Route Handlers (app/api/intake/...),
 * same "no NEXT_PUBLIC_ base URL" discipline apps/restaurant established
 * for the staff app. CP4's intake endpoints don't require a bearer token
 * (guest-first — see docs/decisions.md), so unlike apps/restaurant's
 * apiFetch this one has no Authorization header at all yet; a customer
 * session token would be threaded through here if/when OTP login is wired
 * into this app (out of CP4's scope).
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
  }
}

function apiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (!url) throw new Error("API_BASE_URL is required");
  return url;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store", // an intake turn's response must always be live — never cached
  });

  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
