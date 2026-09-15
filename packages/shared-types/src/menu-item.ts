/**
 * CP3 — menu item validation, shared between apps/api (request validation
 * via ZodValidationPipe) and apps/restaurant (the admin form's client- and
 * server-side validation), so the two never drift into checking different
 * rules for the same field. See docs/decisions.md.
 */
import { z } from "zod";

/**
 * Allergens are STRUCTURED tags, not free text (Part 3's design note,
 * locked in CP1 — see docs/decisions.md's CP1 schema-shape entry). A fixed
 * set, not an open string, is what lets the admin UI offer structured
 * selection (checkboxes, not a text box) and lets CP8's kitchen display
 * render "no peanuts anywhere on this table" as a flagged line rather than
 * parsed prose. Matches the naming already used by apps/api/prisma/seed.ts
 * ("gluten", "dairy") plus the rest of the common major-allergen set.
 */
export const ALLERGEN_TAGS = [
  "gluten",
  "dairy",
  "peanuts",
  "tree_nuts",
  "egg",
  "soy",
  "fish",
  "shellfish",
  "sesame",
] as const;

export type AllergenTag = (typeof ALLERGEN_TAGS)[number];

export const allergenTagSchema = z.enum(ALLERGEN_TAGS);

/**
 * `prepTimeMinutes` must be a required positive integer and must NEVER
 * silently default to 0 — CP6 computes
 * `kitchen_start = arrival_eta - max(prepTimeMinutes) - buffer`, and a
 * zero-defaulted dish makes the kitchen start too late with nothing
 * surfacing it as an error. `z.number().int().positive()` rejects 0,
 * negatives, and non-integers outright; there is no `.default()` anywhere
 * on this field, on purpose.
 */
const prepTimeMinutesSchema = z
  .number()
  .int("prepTimeMinutes must be a whole number of minutes")
  .positive("prepTimeMinutes must be greater than zero");

/** Accepts a decimal string ("12.50") or a plain number; Prisma's Decimal column takes either as input. */
const priceSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), {
    message: "price must be a non-negative number with at most 2 decimal places",
  });

const nonEmptyString = z.string().trim().min(1);

export const menuItemCreateSchema = z.object({
  name: nonEmptyString,
  description: z.string().trim().min(1).optional(),
  price: priceSchema,
  prepTimeMinutes: prepTimeMinutesSchema,
  category: nonEmptyString,
  allergens: z.array(allergenTagSchema).default([]),
  modifiableOptions: z.array(nonEmptyString).default([]),
  available: z.boolean().default(true),
});

export type MenuItemCreateInput = z.infer<typeof menuItemCreateSchema>;

/**
 * Partial, but every field that IS provided must still satisfy the same
 * rule as on create — in particular, an update can never slip
 * prepTimeMinutes down to 0 either, since `.partial()` only makes fields
 * optional to omit, not exempt from validation when present.
 */
export const menuItemUpdateSchema = menuItemCreateSchema
  .omit({ allergens: true, modifiableOptions: true, available: true })
  .partial()
  .extend({
    allergens: z.array(allergenTagSchema).optional(),
    modifiableOptions: z.array(nonEmptyString).optional(),
    available: z.boolean().optional(),
  });

export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>;

export interface MenuItemDto {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  price: string;
  prepTimeMinutes: number;
  category: string;
  allergens: AllergenTag[];
  modifiableOptions: string[];
  available: boolean;
  createdAt: string;
  updatedAt: string;
}
