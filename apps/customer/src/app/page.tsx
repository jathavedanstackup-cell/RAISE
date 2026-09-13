import { getServiceHealth } from "@/lib/health";

export default function Home() {
  const health = getServiceHealth("customer");

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col gap-4 px-8 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          RAISE — Customer App
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Scaffold placeholder (CP0). Voice/chat intake and booking flow land in later
          checkpoints — see <code className="font-mono text-sm">docs/checkpoints/</code>.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Service health:{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono dark:bg-white/[.08]">
            {health.service}
          </code>{" "}
          —{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono dark:bg-white/[.08]">
            {health.status}
          </code>
        </p>
      </main>
    </div>
  );
}
