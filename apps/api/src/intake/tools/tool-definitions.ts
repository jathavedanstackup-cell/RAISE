import { ALLERGEN_TAGS } from '@raise/shared-types';
import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { ToolExecutionContext, ToolInvocationRecord } from './tool-types.js';
import {
  listAvailableMenuItems,
  listAvailableMenuItemsInputSchema,
  getMenuItemDetails,
  getMenuItemDetailsInputSchema,
  listOpenTables,
  listOpenTablesInputSchema,
  setPartyDetails,
  setPartyDetailsInputSchema,
  addOrderItem,
  addOrderItemInputSchema,
  updateOrderItem,
  updateOrderItemInputSchema,
  removeOrderItem,
  removeOrderItemInputSchema,
  proposeTable,
  proposeTableInputSchema,
} from './tool-handlers.js';

/**
 * Anthropic tool declarations. `strict: true` on every one — Anthropic
 * validates `tool_use.input` against these JSON schemas server-side before
 * the call ever reaches this codebase (defense-in-depth layer 3 in
 * docs/decisions.md's Q2 entry). Deliberately no menu content anywhere in
 * these descriptions — only shapes and instructions to call the read tools
 * for real data.
 */
export const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_available_menu_items',
    description:
      "Get the restaurant's currently available menu items, fresh from the live menu. Call this whenever you need to know what dishes exist, before naming any dish to the customer — you have no menu memorized.",
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_menu_item_details',
    description: 'Get full details (description, price, allergens, modifiable options) for one specific available menu item by id.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { menuItemId: { type: 'string' } },
      required: ['menuItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_open_tables',
    description: "Get the restaurant's currently free tables that fit a given party size.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: { partySize: { type: 'integer', minimum: 1 } },
      required: ['partySize'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_party_details',
    description: "Update the draft visit's party size, whether a child is in the party, special needs (e.g. high_chair), and/or arrival time (ISO 8601).",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        partySize: { type: 'integer', minimum: 1 },
        hasChild: { type: 'boolean' },
        specialNeeds: { type: 'array', items: { type: 'string' } },
        arrivalEta: { type: 'string', description: 'ISO 8601 datetime' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'add_order_item',
    description:
      'Add a dish to the draft order. Only ever call this with a menuItemId that came from a list_available_menu_items or get_menu_item_details result earlier in THIS conversation — the server re-checks it is still real and available before accepting it, and will reject it otherwise.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        menuItemId: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        modifications: { type: 'array', items: { type: 'string' } },
        allergyFlags: { type: 'array', items: { type: 'string', enum: [...ALLERGEN_TAGS] } },
      },
      required: ['menuItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_order_item',
    description: "Change quantity, modifications, or allergy flags on an item already in the draft order (identified by the visitItemId returned when it was added).",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        visitItemId: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        modifications: { type: 'array', items: { type: 'string' } },
        allergyFlags: { type: 'array', items: { type: 'string', enum: [...ALLERGEN_TAGS] } },
      },
      required: ['visitItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_order_item',
    description: 'Remove an item from the draft order (identified by the visitItemId returned when it was added). Use this when the customer changes their mind.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { visitItemId: { type: 'string' } },
      required: ['visitItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_table',
    description: "Tentatively propose a table for the draft visit (identified by the id from a list_open_tables result). This does not hold or book the table — only a later, separate confirmation step does that.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: { tableId: { type: 'string' } },
      required: ['tableId'],
      additionalProperties: false,
    },
  },
];

const REGISTRY = {
  list_available_menu_items: { schema: listAvailableMenuItemsInputSchema, handler: listAvailableMenuItems },
  get_menu_item_details: { schema: getMenuItemDetailsInputSchema, handler: getMenuItemDetails },
  list_open_tables: { schema: listOpenTablesInputSchema, handler: listOpenTables },
  set_party_details: { schema: setPartyDetailsInputSchema, handler: setPartyDetails },
  add_order_item: { schema: addOrderItemInputSchema, handler: addOrderItem },
  update_order_item: { schema: updateOrderItemInputSchema, handler: updateOrderItem },
  remove_order_item: { schema: removeOrderItemInputSchema, handler: removeOrderItem },
  propose_table: { schema: proposeTableInputSchema, handler: proposeTable },
} satisfies Record<string, { schema: z.ZodTypeAny; handler: (ctx: ToolExecutionContext, input: never) => Promise<unknown> }>;

export type ToolName = keyof typeof REGISTRY;

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

/**
 * The single entry point every dialogue engine (dev or Claude) must go
 * through to act on a tool call. Validates the raw input with the same Zod
 * schema regardless of caller — the Anthropic engine's inputs are already
 * `strict: true`-validated by Anthropic, but the dev engine's are not, and
 * this function must behave identically for both, since the grounding
 * guarantee cannot depend on which engine is configured. Returns a
 * structured error result rather than throwing on bad input or a
 * since-invalidated id — the dialogue engine relays that to the customer
 * honestly instead of retrying blindly.
 */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolExecutionContext): Promise<ToolInvocationRecord> {
  if (!isToolName(name)) {
    return { name, input: rawInput, result: { ok: false, reason: 'unknown_tool' } };
  }
  const entry = REGISTRY[name];
  const parsed = entry.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { name, input: rawInput, result: { ok: false, reason: 'invalid_input', issues: parsed.error.issues } };
  }
  const result = await entry.handler(ctx, parsed.data as never);
  return { name, input: parsed.data, result };
}
