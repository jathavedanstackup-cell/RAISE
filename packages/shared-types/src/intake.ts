/**
 * CP4 — voice/chat intake pipeline. Shared between apps/api (request
 * validation, response shape) and apps/customer (the chat/voice UI), so the
 * two never drift on what a turn request/response looks like. See
 * docs/decisions.md's CP4 Part 8 entries for the grounding/provider
 * decisions behind this shape.
 */
import { z } from "zod";
import { allergenTagSchema, type AllergenTag } from "./menu-item.js";

/**
 * A single line in the draft order. Always the authoritative, server-
 * validated state — never derived from the assistant's own prose. See
 * docs/decisions.md Q2: the client renders the order from this, not by
 * parsing `assistantMessage`.
 */
export interface VisitItemDto {
  id: string;
  menuItemId: string;
  name: string;
  price: string;
  quantity: number;
  modifications: string[];
  allergyFlags: AllergenTag[];
}

export interface TableProposalDto {
  tableId: string;
  label: string;
  seatsMin: number;
  seatsMax: number;
}

/** The in-progress draft Visit a conversation is building. Status is always `draft` in CP4 — CP5 owns `confirmed`. */
export interface VisitDraftDto {
  id: string;
  restaurantId: string;
  status: "draft";
  partySize: number | null;
  hasChild: boolean;
  specialNeeds: string[];
  arrivalEta: string | null;
  tableProposal: TableProposalDto | null;
  items: VisitItemDto[];
  draftExpiresAt: string | null;
}

export interface ConversationTurnDto {
  id: string;
  role: "customer" | "system";
  transcript: string;
  createdAt: string;
}

/**
 * Request body for `POST /restaurants/:restaurantId/intake/:visitId/turn`.
 * `mode: "voice"` carries a recorded utterance (base64), not a live audio
 * stream — see docs/decisions.md Q1 for why CP4 uses a push-to-talk
 * record-then-transcribe shape rather than a WebSocket bridge.
 */
export const intakeTurnRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("text"),
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({
    mode: z.literal("voice"),
    audioBase64: z.string().min(1),
    mimeType: z.string().trim().min(1),
  }),
]);

export type IntakeTurnRequest = z.infer<typeof intakeTurnRequestSchema>;

export interface IntakeTurnResponse {
  visit: VisitDraftDto;
  turns: ConversationTurnDto[];
  assistantMessage: string;
  /** True when this response is the recap-and-reconfirm prompt triggered by a draft that sat past its expiry window. See docs/decisions.md Q3. */
  reengaged: boolean;
}

export { allergenTagSchema };
