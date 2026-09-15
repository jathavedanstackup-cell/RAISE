import type { IntakeTurnResponse } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";

export async function POST(request: Request) {
  const { restaurantId } = (await request.json()) as { restaurantId?: string };
  if (!restaurantId) return Response.json({ message: "restaurantId is required" }, { status: 400 });

  try {
    const result = await apiFetch<IntakeTurnResponse>(`/restaurants/${restaurantId}/intake/start`, {
      method: "POST",
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Something went wrong starting your visit." }, { status: 502 });
  }
}
