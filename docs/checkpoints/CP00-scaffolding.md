# CP0 — Repo & infra scaffolding

Source: `docs/production-plan.md`, Part 6.

**Deliverables**: monorepo structure (customer app, restaurant app, API, shared types package), Docker Compose for local Postgres, CI pipeline (lint/typecheck/test on PR), environment config pattern (`.env.example`), base README.

**Done when**: `docker compose up` gives a working local Postgres; `npm run dev` boots API + both frontends; CI passes on an empty/scaffold commit.

**Scope note**: infrastructure only. No product data model, no auth, no real UI beyond a placeholder page per app — those are CP1 and CP2 (see `docs/checkpoints/` once created, and `docs/production-plan.md` Part 6 for the full checkpoint sequence).

**Recommended stack** (full rationale in `docs/production-plan.md` Part 2.2): Next.js for both frontends (customer app + restaurant dashboard/KDS app), NestJS for the API, PostgreSQL (Docker locally), shared TypeScript types package across frontend and backend.

**If ambiguous, stop and ask rather than guessing** — in particular the monorepo tooling choice (Turborepo / Nx / plain npm workspaces) if it isn't already obvious from context.
