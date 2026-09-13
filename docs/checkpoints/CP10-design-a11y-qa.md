# CP10 — Design QA & accessibility pass

Source: `docs/production-plan.md`, Part 6 / Part 7.

**Deliverables**: run `design:accessibility-review` against both the real customer and restaurant/kitchen UIs (this is a re-run — a concept-level pass already happened pre-build, see `docs/accessibility-audit.md`, but it only measured color contrast on static mockups; keyboard access, touch targets, and ARIA/live-region behavior can only be verified now that real screens exist); run `design:design-critique` on the dashboard and KDS specifically.

**Done when**: WCAG 2.1 AA passes on both UIs; critique findings triaged and either fixed or explicitly deferred with reason (record deferrals in `docs/decisions.md`).

**Depends on**: CP4, CP7, CP8 merged.
