import { apiFetch, ApiError } from "@/lib/api-client";

/** Proxies CP2's real, unchanged phone-OTP request endpoint -- reused as-is, not rebuilt. */
export async function POST(request: Request) {
  const { phone } = (await request.json()) as { phone?: string };
  if (!phone) return Response.json({ message: "phone is required" }, { status: 400 });

  try {
    const result = await apiFetch<{ ok: true }>("/auth/customer/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Something went wrong sending that code." }, { status: 502 });
  }
}
