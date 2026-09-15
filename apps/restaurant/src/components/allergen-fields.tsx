import { ALLERGEN_TAGS, type AllergenTag } from "@raise/shared-types";

const ALLERGEN_LABELS: Record<AllergenTag, string> = {
  gluten: "Gluten",
  dairy: "Dairy",
  peanuts: "Peanuts",
  tree_nuts: "Tree nuts",
  egg: "Egg",
  soy: "Soy",
  fish: "Fish",
  shellfish: "Shellfish",
  sesame: "Sesame",
};

/**
 * Structured selection, not free text (Part 3's design note, locked in
 * CP1) — a fixed checklist from the same ALLERGEN_TAGS the API validates
 * against, so there is no way for the admin form to produce a value the
 * API would reject, and no way for an owner to type something CP8's
 * kitchen display couldn't render as a flagged tag.
 */
export function AllergenFields({ selected }: { selected?: readonly AllergenTag[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">Allergens</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ALLERGEN_TAGS.map((tag) => (
          // py-1 clears the WCAG 2.2 SC 2.5.8 24px target-size minimum —
          // the bare text line-height alone measured under it.
          <label key={tag} className="flex items-center gap-2 py-1 text-sm text-foreground">
            <input
              type="checkbox"
              name="allergens"
              value={tag}
              defaultChecked={selected?.includes(tag)}
              className="h-4 w-4 rounded border-border-default"
            />
            {ALLERGEN_LABELS[tag]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Small dark pill reusing the exact measured dark-bg/orange-fg pairing from docs/accessibility-audit.md. */
export function AllergenChips({ allergens }: { allergens: readonly AllergenTag[] }) {
  if (allergens.length === 0) return <span className="text-sm text-text-muted">None listed</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Allergens">
      {allergens.map((tag) => (
        <li
          key={tag}
          className="rounded-full bg-chip-allergen-bg px-2.5 py-0.5 text-xs font-medium text-chip-allergen-fg"
        >
          {ALLERGEN_LABELS[tag]}
        </li>
      ))}
    </ul>
  );
}
