import { z } from 'zod';
import { ALLERGEN_TAGS } from '@raise/shared-types';
import type { ToolExecutionContext } from './tool-types.js';

/**
 * The grounding-enforcement layer (docs/decisions.md, CP4 Part 8 Q2).
 * Every handler here re-queries Postgres at call time through
 * `ctx.tenantPrisma` — no argument is ever trusted just because the model
 * produced it, and no result from an earlier turn is reused without
 * re-checking it here. This file is what makes a hallucinated or
 * since-disabled dish structurally impossible to write into a Visit, not
 * merely unlikely: `add_order_item`/`update_order_item`/`propose_table` are
 * the only functions in this codebase that create/modify a `VisitItem` or
 * set `Visit.tableId` during intake, and every one of them fails closed.
 */

export const listAvailableMenuItemsInputSchema = z.object({}).strict();

export async function listAvailableMenuItems(ctx: ToolExecutionContext) {
  const items = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.menuItem.findMany({
      where: { restaurantId: ctx.restaurantId, available: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  );
  return {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price.toString(),
      category: item.category,
      allergens: item.allergens,
      modifiableOptions: item.modifiableOptions,
    })),
  };
}

export const getMenuItemDetailsInputSchema = z.object({ menuItemId: z.string().min(1) }).strict();

export async function getMenuItemDetails(ctx: ToolExecutionContext, input: z.infer<typeof getMenuItemDetailsInputSchema>) {
  const item = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.menuItem.findFirst({ where: { id: input.menuItemId, restaurantId: ctx.restaurantId, available: true } }),
  );
  if (!item) return { found: false as const };
  return {
    found: true as const,
    item: {
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price.toString(),
      category: item.category,
      allergens: item.allergens,
      modifiableOptions: item.modifiableOptions,
    },
  };
}

export const listOpenTablesInputSchema = z.object({ partySize: z.number().int().positive() }).strict();

export async function listOpenTables(ctx: ToolExecutionContext, input: z.infer<typeof listOpenTablesInputSchema>) {
  const tables = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.table.findMany({
      where: {
        restaurantId: ctx.restaurantId,
        status: 'free',
        seatsMin: { lte: input.partySize },
        seatsMax: { gte: input.partySize },
      },
      orderBy: { seatsMin: 'asc' },
    }),
  );
  return {
    tables: tables.map((table) => ({
      id: table.id,
      label: table.label,
      seatsMin: table.seatsMin,
      seatsMax: table.seatsMax,
      features: table.features,
    })),
  };
}

export const setPartyDetailsInputSchema = z
  .object({
    partySize: z.number().int().positive().optional(),
    hasChild: z.boolean().optional(),
    specialNeeds: z.array(z.string().min(1)).optional(),
    /** ISO 8601 datetime string. */
    arrivalEta: z.string().min(1).optional(),
  })
  .strict();

export async function setPartyDetails(ctx: ToolExecutionContext, input: z.infer<typeof setPartyDetailsInputSchema>) {
  const data: { partySize?: number; hasChild?: boolean; specialNeeds?: string[]; arrivalEta?: Date } = {};
  if (input.partySize !== undefined) data.partySize = input.partySize;
  if (input.hasChild !== undefined) data.hasChild = input.hasChild;
  if (input.specialNeeds !== undefined) data.specialNeeds = input.specialNeeds;
  if (input.arrivalEta !== undefined) {
    const parsed = new Date(input.arrivalEta);
    if (Number.isNaN(parsed.getTime())) return { ok: false as const, reason: 'invalid_arrival_eta' as const };
    data.arrivalEta = parsed;
  }
  await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.visit.updateMany({ where: { id: ctx.visitId, restaurantId: ctx.restaurantId }, data }),
  );
  return { ok: true as const };
}

export const addOrderItemInputSchema = z
  .object({
    menuItemId: z.string().min(1),
    quantity: z.number().int().positive().default(1),
    modifications: z.array(z.string().min(1)).default([]),
    allergyFlags: z.array(z.enum(ALLERGEN_TAGS)).default([]),
  })
  .strict();

export async function addOrderItem(ctx: ToolExecutionContext, input: z.infer<typeof addOrderItemInputSchema>) {
  // The live check: an id from an earlier tool result (or one the model
  // invented outright) is only ever acted on if it resolves, right now, to
  // an available dish at THIS restaurant. Nothing about this check is
  // cached from earlier in the conversation.
  const menuItem = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.menuItem.findFirst({ where: { id: input.menuItemId, restaurantId: ctx.restaurantId, available: true } }),
  );
  if (!menuItem) return { ok: false as const, reason: 'unavailable' as const };

  const created = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.visitItem.create({
      data: {
        restaurantId: ctx.restaurantId,
        visitId: ctx.visitId,
        menuItemId: menuItem.id,
        quantity: input.quantity,
        modifications: input.modifications,
        allergyFlags: input.allergyFlags,
      },
    }),
  );
  return {
    ok: true as const,
    item: {
      id: created.id,
      menuItemId: menuItem.id,
      name: menuItem.name,
      price: menuItem.price.toString(),
      quantity: created.quantity,
      modifications: created.modifications,
      allergyFlags: created.allergyFlags,
    },
  };
}

export const updateOrderItemInputSchema = z
  .object({
    visitItemId: z.string().min(1),
    quantity: z.number().int().positive().optional(),
    modifications: z.array(z.string().min(1)).optional(),
    allergyFlags: z.array(z.enum(ALLERGEN_TAGS)).optional(),
  })
  .strict();

export async function updateOrderItem(ctx: ToolExecutionContext, input: z.infer<typeof updateOrderItemInputSchema>) {
  const data: { quantity?: number; modifications?: string[]; allergyFlags?: string[] } = {};
  if (input.quantity !== undefined) data.quantity = input.quantity;
  if (input.modifications !== undefined) data.modifications = input.modifications;
  if (input.allergyFlags !== undefined) data.allergyFlags = input.allergyFlags;

  // updateMany + where.visitId/restaurantId (not update-by-id alone): a
  // stale or cross-visit visitItemId matches zero rows instead of touching
  // another draft's line — same direct-object-reference discipline CP3
  // used for menu-item updates.
  const result = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.visitItem.updateMany({
      where: { id: input.visitItemId, visitId: ctx.visitId, restaurantId: ctx.restaurantId },
      data,
    }),
  );
  if (result.count === 0) return { ok: false as const, reason: 'not_found' as const };
  return { ok: true as const };
}

export const removeOrderItemInputSchema = z.object({ visitItemId: z.string().min(1) }).strict();

export async function removeOrderItem(ctx: ToolExecutionContext, input: z.infer<typeof removeOrderItemInputSchema>) {
  const result = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.visitItem.deleteMany({ where: { id: input.visitItemId, visitId: ctx.visitId, restaurantId: ctx.restaurantId } }),
  );
  return { ok: result.count > 0 };
}

export const proposeTableInputSchema = z.object({ tableId: z.string().min(1) }).strict();

export async function proposeTable(ctx: ToolExecutionContext, input: z.infer<typeof proposeTableInputSchema>) {
  // Tentative only — CP4 never writes Table.status. See docs/decisions.md
  // Part 8 Q3: the real, booking-blocking hold is CP5's job.
  const table = await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.table.findFirst({ where: { id: input.tableId, restaurantId: ctx.restaurantId, status: 'free' } }),
  );
  if (!table) return { ok: false as const, reason: 'unavailable' as const };

  await ctx.tenantPrisma.forRestaurant(ctx.restaurantId, (tx) =>
    tx.visit.updateMany({ where: { id: ctx.visitId, restaurantId: ctx.restaurantId }, data: { tableId: table.id } }),
  );
  return { ok: true as const, table: { id: table.id, label: table.label, seatsMin: table.seatsMin, seatsMax: table.seatsMax } };
}
