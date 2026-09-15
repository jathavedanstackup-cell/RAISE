import { IntakeChat } from "@/components/intake-chat";

/**
 * CP4: single-restaurant selection for v1 (matches CP3's own
 * "Single-Restaurant Selection Pattern for v1" precedent — a real
 * restaurant switcher is CP13/Phase-2 scope). NEXT_PUBLIC_ is fine here,
 * unlike the staff app's API_BASE_URL: a restaurant id is exactly what a
 * public booking link/QR code already exposes (Part 4.1), not a secret.
 */
export default function Home() {
  const restaurantId = process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID ?? "demo-spice-route";

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-8 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">Plan your visit</h1>
        <IntakeChat restaurantId={restaurantId} />
      </main>
    </div>
  );
}
