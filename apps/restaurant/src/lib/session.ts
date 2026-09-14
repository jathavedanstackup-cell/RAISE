import "server-only";
import { cookies } from "next/headers";

/**
 * Staff JWT storage: httpOnly cookie, never localStorage/sessionStorage,
 * never sent to client-side JS at all. See docs/decisions.md ("Staff JWT
 * storage: httpOnly cookie, not localStorage") for the full reasoning —
 * short version: localStorage is trivially readable by any injected
 * script, and this is an owner-privileged token that can disable menu
 * items. The browser only ever talks to this Next.js app's own origin;
 * this app is the only thing that ever attaches the token to a call to
 * the separate NestJS API, and it does so server-side (Route Handlers,
 * Server Components, Server Actions) — the token never reaches the
 * browser's JS runtime in the first place.
 */
const STAFF_TOKEN_COOKIE = "raise_staff_token";
const STAFF_TOKEN_MAX_AGE_SECONDS = 12 * 60 * 60; // matches StaffTokenService's 12h expiry

export async function setStaffTokenCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(STAFF_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STAFF_TOKEN_MAX_AGE_SECONDS,
  });
}

export async function clearStaffTokenCookie(): Promise<void> {
  const store = await cookies();
  store.delete(STAFF_TOKEN_COOKIE);
}

export async function getStaffToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(STAFF_TOKEN_COOKIE)?.value;
}
