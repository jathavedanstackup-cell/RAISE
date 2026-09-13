# CP6 — Timing engine

Source: `docs/production-plan.md`, Part 6.

**⚠️ DO NOT START until `docs/decisions.md` has a filled-in entry for "Kitchen auto-start vs. staff accept-step."** This checkpoint's behavior forks on that decision (see `docs/execution-guide.md` §4).

**Deliverables**: `kitchen_start_time` and `food_out_target` computation from `arrival_eta` + ordered items' `prep_time_minutes`; recompute-on-drift when a customer updates ETA; the full status-transition timestamp log described in `docs/production-plan.md` Part 3.

**Done when**: given the deck's own scenario numbers (order in 7:52, arrival 8:15, kitchen start 7:58, food out 8:18) as a test fixture, the engine reproduces those exact times; an ETA update after confirmation correctly shifts kitchen start and emits a realtime event.

**Depends on**: CP5 merged, and the decision above locked.
