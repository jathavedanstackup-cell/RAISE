# CP11 — Observability & admin tooling

Source: `docs/production-plan.md`, Part 6.

**Deliverables**: structured logging + tracing across the voice pipeline (per-turn latency, ASR/LLM error rates); Sentry error tracking; an internal admin view of live visits across the system for support/debugging.

**Done when**: a failed voice turn is traceable end-to-end from a single log/trace query; error rate dashboards exist.

**Depends on**: CP4 merged (needs the pipeline to instrument).
