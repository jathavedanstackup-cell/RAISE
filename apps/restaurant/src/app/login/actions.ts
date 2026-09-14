"use server";

import { redirect } from "next/navigation";
import { apiLogin, ApiError } from "@/lib/api-client";
import { setStaffTokenCookie } from "@/lib/session";

export interface LoginFormState {
  error?: string;
}

/**
 * Runs entirely server-side (Next.js Server Action): calls apps/api,
 * receives the JWT, and sets it as an httpOnly cookie here — the token is
 * never present in any client-side JS state, never in localStorage. See
 * docs/decisions.md ("Staff JWT storage").
 */
export async function loginAction(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Enter both an email and a password." };
  }

  try {
    const { token } = await apiLogin(email, password);
    await setStaffTokenCookie(token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { error: "Incorrect email or password." };
    }
    return { error: "Something went wrong signing you in. Please try again." };
  }

  redirect("/menu");
}
