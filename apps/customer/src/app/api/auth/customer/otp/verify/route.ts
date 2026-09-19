import { apiFetch, ApiError } from "@/lib/api-client";

/** Proxies CP2's real, unchanged phone-OTP verify endpoint. Returns a customer token the client holds in memory and sends as X-Customer-Token when confirming. */
export async function POST(request: Request) {
  const { phone, code } = (await request.json()) as { phone?: string; code?: string };
  if (!phone || !code) return Response.json({ message: "phone and code are required" }, { status: 400 });

  try {
    const result = await apiFetch<{ token: string }>("/auth/customer/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(error.body, { status: error.status });
    return Response.json({ message: "Something went wrong verifying that code." }, { status: 502 });
  }
}
