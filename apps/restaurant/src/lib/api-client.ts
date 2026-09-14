import "server-only";

/**
 * Every call to apps/api goes through here, server-side only, using
 * API_BASE_URL (no NEXT_PUBLIC_ prefix — never exposed to the browser).
 * The Bearer token comes from the httpOnly cookie (see session.ts), read
 * server-side and attached here; it never touches client-side JS.
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

export async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store", // menu data must always be read live — see docs/decisions.md / Part 5
  });

  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export async function apiLogin(email: string, password: string): Promise<{ token: string }> {
  const res = await fetch(`${apiBaseUrl()}/auth/staff/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}
