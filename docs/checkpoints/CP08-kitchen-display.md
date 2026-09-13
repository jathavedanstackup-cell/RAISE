# CP8 — Kitchen display system (KDS)

Source: `docs/production-plan.md`, Part 6.

**⚠️ DO NOT START until `docs/decisions.md` has a filled-in entry for "Allergy flag: passive display vs. staff acknowledgment."** (See `docs/execution-guide.md` §4.)

**Deliverables**: prep queue ordered by computed `kitchen_start_time` (not order-in time); allergy/modification flags rendered as prominent, scannable tags (not prose); stage-completion controls (food out, etc.).

**Done when**: items appear on the KDS at their computed start time, not before; an allergy flag is visually impossible to miss in a usability pass.

**Design input**: resolve the double-duty accent color (used for both "priority/next" and "allergy/warning" in the concept deck) before building this — see `docs/concept-critique.md`. Consider a visually distinct treatment for safety flags specifically.

**Depends on**: CP6 merged, and the decision above locked.
