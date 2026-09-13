# CP9 — Notifications

Source: `docs/production-plan.md`, Part 6.

**Deliverables**: SMS/push confirmation to customer on booking; restaurant-side alert on new inbound visit; drift-alert to staff if a customer's ETA changes significantly post-confirmation.

**Done when**: each event type reliably fires exactly once (idempotency test — no duplicate SMS on retry/reconnect).

**Depends on**: CP5, CP6 merged.
