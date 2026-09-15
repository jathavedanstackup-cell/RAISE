import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { requireEnv } from '../../auth/env.util.js';
import { ANTHROPIC_TOOLS } from '../tools/tool-definitions.js';
import { INTAKE_SYSTEM_PROMPT } from './system-prompt.js';
import type { DialogueEngine, DialogueTurnInput, DialogueTurnOutput } from './dialogue-engine.interface.js';
import type { ToolInvocationRecord } from '../tools/tool-types.js';

/**
 * Real dialogue engine — Claude Sonnet 5 (docs/decisions.md, Part 8 Q2).
 * Deliberately untested in CI, same as CP2's TwilioOtpProvider and this
 * checkpoint's DeepgramAsrProvider: only instantiated when
 * LLM_PROVIDER=anthropic, which requires ANTHROPIC_API_KEY and is never set
 * in CI. The grounding mechanism itself (tool-definitions.ts /
 * tool-handlers.ts) is provider-independent and IS fully tested — this
 * class only decides which tools to call and what to say, never what gets
 * written to the draft.
 *
 * A manual tool-use loop, not the SDK's beta Tool Runner: this pipeline
 * needs precise control over what happens between a rejected tool call and
 * the model's next turn, and an iteration cap for latency — see
 * docs/decisions.md for the full reasoning (same "fewer moving parts, no
 * beta dependency" call CP2 made for its JWT guard).
 */
const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ITERATIONS = 6;

@Injectable()
export class ClaudeDialogueEngine implements DialogueEngine {
  private readonly logger = new Logger(ClaudeDialogueEngine.name);
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  }

  async runTurn(input: DialogueTurnInput): Promise<DialogueTurnOutput> {
    const messages: Anthropic.MessageParam[] = [
      ...input.history.map((turn): Anthropic.MessageParam => ({
        role: turn.role === 'customer' ? 'user' : 'assistant',
        content: turn.text,
      })),
      { role: 'user', content: input.customerMessage },
    ];

    const toolInvocations: ToolInvocationRecord[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: INTAKE_SYSTEM_PROMPT,
        tools: ANTHROPIC_TOOLS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        messages,
      });

      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();
        return { assistantMessage: text || "Sorry, could you say that again?", toolInvocations };
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const record = await input.execute(toolUse.name, toolUse.input);
        toolInvocations.push(record);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(record.result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    this.logger.warn(`Hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) for visit ${input.visitId}`);
    return {
      assistantMessage: "Sorry, let me slow down — could you tell me again what you'd like?",
      toolInvocations,
    };
  }
}
