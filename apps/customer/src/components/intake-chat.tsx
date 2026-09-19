"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfirmedVisitDto, ConversationTurnDto, IntakeTurnResponse, VisitDraftDto } from "@raise/shared-types";
import { ConfirmPanel } from "./confirm-panel";

// Browser feature detection that's intentionally allowed to differ between
// the server-rendered HTML (no `window`) and the client's first real paint —
// useSyncExternalStore is the supported way to do that without React
// flagging it as a hydration mismatch (unlike a plain useState/useEffect
// pair, which produced exactly that mismatch here in practice).
function subscribeNever() {
  return () => {};
}
function getVoiceSupportSnapshot() {
  return typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
}
function getVoiceSupportServerSnapshot() {
  return false;
}

/**
 * Voice and text are equally-weighted, first-class paths into the same
 * conversation — not "voice, with a small fallback link." Per
 * docs/accessibility-audit.md priority fix #1: the toggle below is a real,
 * labeled, keyboard-reachable pair of buttons with visible focus and
 * aria-pressed state, not a small dot. Whichever mode is inactive stays in
 * the DOM with `hidden` (removed from the accessibility tree, not just
 * visually hidden) rather than being unmounted, so switching never loses
 * page state for a screen-reader or keyboard user.
 *
 * The order/party/table summary panel is rendered only from `draft`
 * (the server's structured state) — never parsed out of chat text. See
 * docs/decisions.md Q2: narration and truth are different things, and the
 * UI only ever trusts the latter.
 */
export function IntakeChat({ restaurantId }: { restaurantId: string }) {
  const [visitId, setVisitId] = useState<string | null>(null);
  // CP4 pre-merge fix: visitId alone used to be treated as sufficient to
  // read/mutate a draft — it isn't a credential (it travels in the URL,
  // server logs, browser history). This token is the real bearer
  // credential now; held only in memory, never in localStorage or a URL.
  const [draftToken, setDraftToken] = useState<string | null>(null);
  const [draft, setDraft] = useState<VisitDraftDto | null>(null);
  const [turns, setTurns] = useState<ConversationTurnDto[]>([]);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [textValue, setTextValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [confirmedVisit, setConfirmedVisit] = useState<ConfirmedVisitDto | null>(null);
  const voiceSupported = useSyncExternalStore(subscribeNever, getVoiceSupportSnapshot, getVoiceSupportServerSnapshot);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/intake/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantId }),
        });
        const body = (await res.json()) as IntakeTurnResponse & { message?: string };
        if (!res.ok) throw new Error(body.message ?? "Couldn't start your visit.");
        setVisitId(body.visit.id);
        setDraftToken(body.draftToken);
        setDraft(body.visit);
        setTurns(body.turns);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't start your visit.");
      } finally {
        setBusy(false);
      }
    })();
  }, [restaurantId]);

  async function submitTurn(payload: { mode: "text"; text: string } | { mode: "voice"; audioBase64: string; mimeType: string }) {
    if (!visitId || !draftToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/${visitId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${draftToken}` },
        body: JSON.stringify({ restaurantId, ...payload }),
      });
      const body = (await res.json()) as IntakeTurnResponse & { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Something went wrong sending that.");
      setDraftToken(body.draftToken); // reissued fresh on every response — see docs/decisions.md
      setDraft(body.visit);
      setTurns((prev) => [...prev, ...body.turns]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong sending that.");
    } finally {
      setBusy(false);
    }
  }

  function handleTextSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = textValue.trim();
    if (!text) return;
    setTextValue("");
    void submitTurn({ mode: "text", text });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const audioBase64 = await blobToBase64(blob);
        void submitTurn({ mode: "voice", audioBase64, mimeType: recorder.mimeType || "audio/webm" });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Couldn't access your microphone — try typing instead.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  if (confirmedVisit) {
    // A deliberately distinct view, not another chat bubble — this is the
    // single most consequential moment in the whole flow (Part 5's trust
    // boundary). See docs/concept-critique.md's finding that a confirmation
    // buried at the same visual weight as ordinary conversation undersells it.
    return (
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-lg border-4 border-black bg-zinc-50 p-6 text-center dark:border-white dark:bg-zinc-900">
        <h1 className="text-2xl font-bold">You&apos;re booked!</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-sm">
          <dt className="font-medium">Party size</dt>
          <dd>{confirmedVisit.partySize}</dd>
          <dt className="font-medium">Arrival</dt>
          <dd>{new Date(confirmedVisit.arrivalEta).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</dd>
          <dt className="font-medium">Table</dt>
          <dd>{confirmedVisit.table.label}</dd>
        </dl>
        {confirmedVisit.items.length > 0 && (
          <ul className="list-disc pl-5 text-left text-sm">
            {confirmedVisit.items.map((item) => (
              <li key={item.id}>
                {item.quantity}x {item.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <div role="group" aria-label="Choose how to talk to us" className="flex gap-2">
        <button
          type="button"
          aria-pressed={mode === "voice"}
          onClick={() => setMode("voice")}
          disabled={!voiceSupported}
          className="min-h-11 flex-1 rounded-lg border-2 px-4 py-2 text-base font-medium transition-colors data-[active=true]:border-black data-[active=true]:bg-black data-[active=true]:text-white dark:data-[active=true]:border-white dark:data-[active=true]:bg-white dark:data-[active=true]:text-black border-zinc-400 text-zinc-900 dark:border-zinc-500 dark:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          data-active={mode === "voice"}
        >
          🎤 Speak
        </button>
        <button
          type="button"
          aria-pressed={mode === "text"}
          onClick={() => setMode("text")}
          className="min-h-11 flex-1 rounded-lg border-2 px-4 py-2 text-base font-medium transition-colors data-[active=true]:border-black data-[active=true]:bg-black data-[active=true]:text-white dark:data-[active=true]:border-white dark:data-[active=true]:bg-white dark:data-[active=true]:text-black border-zinc-400 text-zinc-900 dark:border-zinc-500 dark:text-zinc-100"
          data-active={mode === "text"}
        >
          ⌨️ Type
        </button>
      </div>
      {!voiceSupported && <p className="text-sm text-zinc-500">Voice isn&apos;t available in this browser — typing works just as well.</p>}

      <div aria-live="polite" className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-300 p-3 dark:border-zinc-700" role="log">
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              turn.role === "customer" ? "self-end bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50" : "self-start bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            }`}
          >
            {turn.transcript}
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <div hidden={mode !== "voice"}>
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={busy || !voiceSupported}
          aria-pressed={recording}
          className="min-h-11 w-full rounded-lg bg-black px-4 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {recording ? "⏹ Stop and send" : "🎤 Hold to talk (tap to start)"}
        </button>
      </div>

      <form hidden={mode !== "text"} onSubmit={handleTextSubmit} className="flex gap-2">
        <label htmlFor="intake-text-input" className="sr-only">
          Type your message
        </label>
        <input
          id="intake-text-input"
          type="text"
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
          disabled={busy}
          placeholder="Type here…"
          className="min-h-11 flex-1 rounded-lg border border-zinc-400 px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-900"
        />
        <button type="submit" disabled={busy || !textValue.trim()} className="min-h-11 rounded-lg bg-black px-4 py-2 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black">
          Send
        </button>
      </form>

      {draft && (
        <div className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <h2 className="mb-2 font-semibold">Your visit so far</h2>
          <p>{draft.partySize ? `Party of ${draft.partySize}` : "Party size not set yet"}</p>
          {draft.arrivalEta && <p>Arriving around {new Date(draft.arrivalEta).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
          {draft.tableProposal && <p>Table: {draft.tableProposal.label}</p>}
          <ul className="mt-2 list-disc pl-5">
            {draft.items.map((item) => (
              <li key={item.id}>
                {item.quantity}x {item.name}
                {item.allergyFlags.length > 0 && <span> — {item.allergyFlags.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && visitId && draftToken && (
        <ConfirmPanel restaurantId={restaurantId} visitId={visitId} draftToken={draftToken} draft={draft} onConfirmed={setConfirmedVisit} />
      )}
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
