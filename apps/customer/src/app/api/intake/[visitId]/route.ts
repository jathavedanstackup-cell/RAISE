import type { NextRequest } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-client";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/intake/[visitId]">) {
  const { visitId } = await ctx.params;
  const restaurantId = request.nextUrl.searchParams.get("restaurantId");
  if (!restaurantId) return Response.json({ message: "restaurantId is required" }, { status: 400 });

  // CP4 pre-merge fix — see the turn route's identical comment.
  const authorization = request.headers.get("authorization");
  if (!authorization) return Response.json({ message: "Missing draft token" }, { status: 401 });

  try {
    const result = await apiFetch(`/restaurants/${restaurantId}/intake/${visitId}`, {
      headers: { Authorization: authorization },
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Something went wrong loading your visit." }, { status: 502 });
  }
}
