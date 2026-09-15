import type { ToolInvocationRecord } from '../tools/tool-types.js';
import type { VisitDraftDto } from '@raise/shared-types';

export interface DialogueHistoryTurn {
  role: 'customer' | 'system';
  text: string;
}

export interface DialogueTurnInput {
  restaurantId: string;
  visitId: string;
  /** Prior turns for this draft, oldest first. Does not include `customerMessage`. */
  history: DialogueHistoryTurn[];
  customerMessage: string;
  /** The only way any engine may read or write live menu/table/order state — see docs/decisions.md Q2. */
  execute: (name: string, input: unknown) => Promise<ToolInvocationRecord>;
  /** Convenience read of the draft's current structured state (for constructing an accurate read-back). Never the source of what gets written — only tool calls through `execute` do that. */
  getDraftState: () => Promise<VisitDraftDto>;
}

export interface DialogueTurnOutput {
  assistantMessage: string;
  toolInvocations: ToolInvocationRecord[];
}

export interface DialogueEngine {
  runTurn(input: DialogueTurnInput): Promise<DialogueTurnOutput>;
}

export const DIALOGUE_ENGINE = Symbol('DIALOGUE_ENGINE');
