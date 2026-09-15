/**
 * ASR is one of the "don't hand-roll, and don't trust silently" primitives
 * this checkpoint calls out (Part 8 Q1) — see docs/decisions.md for why
 * Deepgram is the real provider and why this interface takes a recorded
 * clip rather than a live stream. Mirrors CP2's OtpProvider shape exactly
 * (interface + injection token + dev stub + real provider, swapped by env
 * var) so ASR/CI behave the same way every other external provider in this
 * repo already does.
 */
export interface AsrTranscriptionResult {
  transcript: string;
  /** True when the provider itself flags low confidence — the pipeline asks the customer to repeat rather than guessing (the "ASR mishears" unhappy path). */
  lowConfidence: boolean;
}

export interface AsrProvider {
  transcribe(audio: { base64: string; mimeType: string }): Promise<AsrTranscriptionResult>;
}

export const ASR_PROVIDER = Symbol('ASR_PROVIDER');
