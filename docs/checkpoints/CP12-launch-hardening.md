# CP12 — Launch readiness / security hardening

Source: `docs/production-plan.md`, Part 6.

**Deliverables**: rate limiting on intake endpoints; secrets management review; data retention policy implementation (conversation transcripts, PII); load test of the confirm+realtime path at expected single-restaurant peak (dinner rush concurrency).

**Done when**: security checklist signed off; load test meets target latency under peak concurrent visits for one restaurant.

**Don't rush this one** — per `docs/execution-guide.md` §3, budget 1-2 days minimum.

**Depends on**: CP0-CP11 merged.
