import type { IntakeTurnResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";

export async function POST(request: Request, ctx: RouteContext<"/api/intake/[visitId]/turn">) {
  const { visitId } = await ctx.params;
  const { restaurantId, ...turn } = (await request.json()) as { restaurantId?: string } & Record<string, unknown>;
  if (!restaurantId) return Response.json({ message: "restaurantId is required" }, { status: 400 });

  try {
    const result = await apiFetch<IntakeTurnResponse>(`/restaurants/${restaurantId}/intake/${visitId}/turn`, {
      method: "POST",
      body: JSON.stringify(turn),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Something went wrong sending that." }, { status: 502 });
  }
}
