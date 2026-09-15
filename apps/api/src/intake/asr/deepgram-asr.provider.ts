import { Injectable, Logger } from '@nestjs/common';
import { DeepgramClient, DeepgramError } from '@deepgram/sdk';
import { requireEnv } from '../../auth/env.util.js';
import type { AsrProvider, AsrTranscriptionResult } from './asr-provider.interface.js';

/**
 * Real ASR provider (Part 8 Q1 — see docs/decisions.md). Deliberately
 * untested in CI, same as CP2's TwilioOtpProvider: this class is only
 * instantiated when ASR_PROVIDER=deepgram, which requires DEEPGRAM_API_KEY
 * and is never set in CI. Uses Deepgram's prerecorded transcription
 * endpoint (a recorded clip, not a live socket) — see the ASR-provider
 * interface's own doc comment and docs/decisions.md for why CP4 records a
 * push-to-talk utterance rather than streaming continuous audio.
 *
 * LOW_CONFIDENCE_THRESHOLD: below this per-alternative confidence score,
 * the pipeline treats the turn as a probable mishear and asks the customer
 * to repeat rather than acting on a guess — the concrete mechanism behind
 * this checkpoint's "ASR mishears" unhappy path.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

@Injectable()
export class DeepgramAsrProvider implements AsrProvider {
  private readonly logger = new Logger(DeepgramAsrProvider.name);
  private readonly client: DeepgramClient;

  constructor() {
    this.client = new DeepgramClient({ apiKey: requireEnv('DEEPGRAM_API_KEY') });
  }

  async transcribe(audio: { base64: string; mimeType: string }): Promise<AsrTranscriptionResult> {
    const buffer = Buffer.from(audio.base64, 'base64');
    try {
      const response = await this.client.listen.v1.media.transcribeFile(
        { data: buffer, contentType: audio.mimeType },
        { model: 'nova-3', smart_format: true },
      );

      // Only the synchronous shape (no `callback`) carries `results` —
      // narrow away the async-accepted shape before reading it.
      if (!('results' in response)) {
        return { transcript: '', lowConfidence: true };
      }

      const alternative = response.results.channels[0]?.alternatives?.[0];
      const transcript = alternative?.transcript ?? '';
      const confidence = alternative?.confidence ?? 0;

      if (!transcript) {
        return { transcript: '', lowConfidence: true };
      }
      return { transcript, lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD };
    } catch (err) {
      if (err instanceof DeepgramError) {
        this.logger.error(`Deepgram transcription failed (${err.statusCode}): ${err.message}`);
      }
      throw err;
    }
  }
}
