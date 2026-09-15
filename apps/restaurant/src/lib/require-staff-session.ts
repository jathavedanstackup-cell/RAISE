import "server-only";
import { redirect } from "next/navigation";
import type { StaffMeDto } from "@raise/shared-types";
import { apiFetch, ApiError } from "./api-client";
import { getStaffToken, clearStaffTokenCookie } from "./session";

export interface StaffSession {
  token: string;
  me: StaffMeDto;
  /**
   * v1 is single-restaurant (Part 1.6 non-goals: chains are Phase 2/CP13).
   * A staff member's schema already supports more than one membership
   * (see docs/decisions.md, "staff <-> restaurant shape"), so this picks
   * the first rather than assuming there's exactly one — the day CP13
   * lands, this is the one line that needs a real picker UI, not a schema
   * or auth change.
   */
  restaurantId: string;
  restaurantName: string;
  role: StaffMeDto["memberships"][number]["role"];
}

/** Redirects to /login if there's no valid session. Use at the top of any protected Server Component/action. */
export async function requireStaffSession(): Promise<StaffSession> {
  const token = await getStaffToken();
  if (!token) redirect("/login");

  let me: StaffMeDto;
  try {
    me = await apiFetch<StaffMeDto>("/auth/staff/me", token);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
      await clearStaffTokenCookie();
      redirect("/login");
    }
    throw error;
  }

  const [primary] = me.memberships;
  if (!primary) {
    // A staff account that exists but has no restaurant membership at all
    // isn't a login failure — it's a real, distinct state worth its own
    // honest message rather than a silent redirect loop.
    throw new Error("This staff account has no restaurant membership yet.");
  }

  return {
    token,
    me,
    restaurantId: primary.restaurantId,
    restaurantName: primary.restaurantName,
    role: primary.role,
  };
}
