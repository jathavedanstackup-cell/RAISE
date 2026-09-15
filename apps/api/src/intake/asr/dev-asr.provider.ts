import { Injectable } from '@nestjs/common';
import type { AsrProvider, AsrTranscriptionResult } from './asr-provider.interface.js';

/**
 * Non-production ASR stub: never calls Deepgram, never requires
 * DEEPGRAM_API_KEY. Dev/CI/test callers send the fixture transcript itself,
 * base64-encoded, in place of a real audio clip — this is what lets
 * intake.e2e-spec.ts exercise the full "voice" request path (mode: "voice")
 * deterministically without a browser, a microphone, or a live provider.
 * `mimeType: "text/plain;low-confidence"` is a fixture-only convention that
 * flags the result as low-confidence, for testing the "ASR mishears" path.
 */
@Injectable()
export class DevAsrProvider implements AsrProvider {
  async transcribe(audio: { base64: string; mimeType: string }): Promise<AsrTranscriptionResult> {
    const transcript = Buffer.from(audio.base64, 'base64').toString('utf8');
    return {
      transcript,
      lowConfidence: audio.mimeType === 'text/plain;low-confidence',
    };
  }
}
