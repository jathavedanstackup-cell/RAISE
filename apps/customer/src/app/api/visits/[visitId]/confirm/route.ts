import type { ConfirmVisitResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * CP5: relays BOTH tokens the trust boundary requires -- the draft token
 * (Authorization, proves "you hold this draft") and the verified-customer
 * token (X-Customer-Token, proves "you're phone-verified") -- to
 * `POST /restaurants/:restaurantId/visits/:visitId/confirm`. Neither alone
 * is sufficient; this route never inspects or stores either, just relays.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/visits/[visitId]/confirm">) {
  const { visitId } = await ctx.params;
  const { restaurantId } = (await request.json()) as { restaurantId?: string };
  if (!restaurantId) return Response.json({ message: "restaurantId is required" }, { status: 400 });

  const authorization = request.headers.get("authorization");
  const customerToken = request.headers.get("x-customer-token");
  if (!authorization) return Response.json({ message: "Missing draft token" }, { status: 401 });
  if (!customerToken) return Response.json({ message: "Missing verified customer token" }, { status: 401 });

  try {
    const result = await apiFetch<ConfirmVisitResponse>(`/restaurants/${restaurantId}/visits/${visitId}/confirm`, {
      method: "POST",
      headers: { Authorization: authorization, "X-Customer-Token": customerToken },
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Something went wrong confirming your booking." }, { status: 502 });
  }
}
