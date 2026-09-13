# CP5 — Confirmation & booking flow

Source: `docs/production-plan.md`, Part 6.

**Deliverables**: explicit `POST /visits/:id/confirm` endpoint gated on unambiguous customer confirmation; table hold logic on confirm; hold auto-expiry for abandoned drafts; customer-facing confirmation screen/SMS.

**Done when**: no code path can set `Visit.status = confirmed` without passing through the explicit confirm action; abandoned drafts release their table hold after the configured window.

**Care flag**: this is a trust-boundary checkpoint — "nothing is booked until the customer says yes" is a product/legal guarantee, not just a UX nicety. Do not let confirmation be inferred from conversational sentiment.

**Depends on**: CP4 merged.
