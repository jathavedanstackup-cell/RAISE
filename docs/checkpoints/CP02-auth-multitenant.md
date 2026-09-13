# CP2 — Multi-tenant auth & roles

Source: `docs/production-plan.md`, Part 6 (see also Part 2.3 for the multi-tenancy stance).

**Deliverables**: restaurant staff auth (owner/FOH/kitchen roles) scoped to `restaurant_id`; customer auth (phone-based, low-friction, can start a session before full signup); tenant-isolation middleware/query guards.

**Done when**: a staff user from Restaurant A cannot read/write Restaurant B's data (explicit isolation test); role checks enforced on every restaurant-side endpoint.

**Care flag**: this is a trust-boundary checkpoint (per `docs/execution-guide.md` §5) — do not guess on isolation shortcuts, write the explicit cross-tenant test.

**Depends on**: CP1 merged.
