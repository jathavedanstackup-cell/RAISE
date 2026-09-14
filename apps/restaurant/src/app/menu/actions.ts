"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { menuItemCreateSchema, menuItemUpdateSchema } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";
import { clearStaffTokenCookie } from "@/lib/session";

export async function logoutAction(): Promise<void> {
  await clearStaffTokenCookie();
  redirect("/login");
}

export interface MenuFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Same zod schema apps/api validates the request body with (see
 * @raise/shared-types) — parsed here too so the form can show field-level
 * errors without a round trip, and so "prepTimeMinutes must be a positive
 * integer" / "allergens must be from the structured list" are exactly one
 * rule, defined once, not two hand-written copies that could drift apart.
 * The API's own validation is still the actual enforcement boundary —
 * this parse is for UX, not the trust boundary.
 *
 * `modifiableOptions` is deliberately NOT read here — this form has no
 * control for it yet (out of CP3's deliverable list). Omitting the key
 * entirely (not sending `[]`) matters: on create, the schema's own
 * `.default([])` fills it in; on update, its schema field is `.optional()`
 * with no default, so an absent key means Prisma's `updateMany` leaves the
 * column untouched. Sending `[]` unconditionally here would instead wipe
 * an existing dish's modifiable options on every single edit.
 */
function readMenuItemForm(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price: formData.get("price"),
    prepTimeMinutes: formData.get("prepTimeMinutes") ? Number(formData.get("prepTimeMinutes")) : undefined,
    category: formData.get("category"),
    allergens: formData.getAll("allergens"),
    available: formData.get("available") === "on",
  };
}

function fieldErrorsFrom(error: import("zod").ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export async function createMenuItemAction(_prevState: MenuFormState, formData: FormData): Promise<MenuFormState> {
  const session = await requireStaffSession();
  const parsed = menuItemCreateSchema.safeParse(readMenuItemForm(formData));
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    await apiFetch(`/restaurants/${session.restaurantId}/menu-items`, session.token, {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch (error) {
    return { error: describeApiError(error, "creating this dish") };
  }

  revalidatePath("/menu");
  redirect("/menu");
}

export async function updateMenuItemAction(
  id: string,
  _prevState: MenuFormState,
  formData: FormData,
): Promise<MenuFormState> {
  const session = await requireStaffSession();
  const parsed = menuItemUpdateSchema.safeParse(readMenuItemForm(formData));
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    await apiFetch(`/restaurants/${session.restaurantId}/menu-items/${id}`, session.token, {
      method: "PATCH",
      body: JSON.stringify(parsed.data),
    });
  } catch (error) {
    return { error: describeApiError(error, "saving this dish") };
  }

  revalidatePath("/menu");
  redirect("/menu");
}

/**
 * Bound with (id, nextAvailable) from the list page via .bind(), so the
 * form's action is a plain submit with no client JS required — Next.js's
 * convention for a Server Action with pre-filled arguments still expects
 * a trailing FormData parameter even though this one has nothing to read.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Next.js requires this trailing param for bound Server Actions
export async function toggleAvailableAction(id: string, nextAvailable: boolean, _formData: FormData): Promise<void> {
  const session = await requireStaffSession();
  await apiFetch(`/restaurants/${session.restaurantId}/menu-items/${id}`, session.token, {
    method: "PATCH",
    body: JSON.stringify({ available: nextAvailable }),
  });
  revalidatePath("/menu");
}

function describeApiError(error: unknown, action: string): string {
  if (error instanceof ApiError && error.status === 403) {
    return `Only the restaurant owner can make this change.`;
  }
  return `Something went wrong ${action}. Please try again.`;
}
