# CP7 — Restaurant FOH dashboard

Source: `docs/production-plan.md`, Part 6.

**Deliverables**: "Tonight — Inbound" live timeline showing party size, arrival, table, order summary, allergy flags; realtime updates via WebSocket on new/changed visits; manual table reassignment.

**Done when**: a new confirmed visit appears on the dashboard within ~1s without a page refresh; staff can reassign a table and it persists.

**Design input**: mock and build against **realistic volume and mixed status** (15-30+ concurrent visits at varying stages), not the vision deck's simplified 3-row example — see `docs/concept-critique.md` finding on this. Test that the layout still scans in under 2 seconds at real density.

**Depends on**: CP5 merged.
