"use client";

import { useActionState, type ReactNode } from "react";
import type { MenuItemDto } from "@raise/shared-types";
import { AllergenFields } from "./allergen-fields";
import type { MenuFormState } from "@/app/menu/actions";

type FormAction = (prevState: MenuFormState, formData: FormData) => Promise<MenuFormState>;

const initialState: MenuFormState = {};

export function MenuItemForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: FormAction;
  defaultValues?: Pick<
    MenuItemDto,
    "name" | "description" | "price" | "prepTimeMinutes" | "category" | "allergens" | "available"
  >;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field label="Name" name="name" error={state.fieldErrors?.name}>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={defaultValues?.name}
          className={inputClass(!!state.fieldErrors?.name)}
        />
      </Field>

      <Field label="Description (optional)" name="description" error={state.fieldErrors?.description}>
        <input
          id="description"
          name="description"
          type="text"
          defaultValue={defaultValues?.description ?? undefined}
          className={inputClass(!!state.fieldErrors?.description)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Category" name="category" error={state.fieldErrors?.category}>
          <input
            id="category"
            name="category"
            type="text"
            required
            defaultValue={defaultValues?.category}
            className={inputClass(!!state.fieldErrors?.category)}
          />
        </Field>

        <Field label="Price ($)" name="price" error={state.fieldErrors?.price}>
          <input
            id="price"
            name="price"
            type="text"
            inputMode="decimal"
            required
            defaultValue={defaultValues?.price}
            className={inputClass(!!state.fieldErrors?.price)}
          />
        </Field>
      </div>

      <Field
        label="Prep time (minutes)"
        name="prepTimeMinutes"
        error={state.fieldErrors?.prepTimeMinutes}
        hint="Required. Used to time when the kitchen should start this dish — it can never be left blank or zero."
      >
        <input
          id="prepTimeMinutes"
          name="prepTimeMinutes"
          type="number"
          min={1}
          step={1}
          required
          defaultValue={defaultValues?.prepTimeMinutes}
          className={inputClass(!!state.fieldErrors?.prepTimeMinutes)}
        />
      </Field>

      <AllergenFields selected={defaultValues?.allergens} />

      <label className="flex items-center gap-2 py-1 text-sm text-foreground">
        <input
          type="checkbox"
          name="available"
          defaultChecked={defaultValues?.available ?? true}
          className="h-4 w-4 rounded border-border-default"
        />
        Available on the menu
      </label>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return [
    "rounded-md border px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-zinc-900",
    hasError ? "border-danger" : "border-border-default",
  ].join(" ");
}
