# RAISE — Before You Arrive

Restaurant arrival intelligence & service experience. See `docs/production-plan.md` for the full product and architecture plan.

## Repo structure

```
docs/
  production-plan.md         — full product/architecture plan, 14 checkpoints (Part 6)
  user-research-plan.md      — lean, solo-sized research plan (run before CP6/CP8)
  concept-critique.md        — design critique of the vision deck's UI mockups
  accessibility-audit.md     — measured WCAG contrast audit of the concept screens
  execution-guide.md         — how to run checkpoints through Claude Code efficiently
  decisions.md               — locked decisions log — append only, never delete
  checkpoints/
    CP00-scaffolding.md ... CP13-phase2-integrations.md
```

## How this gets built

One checkpoint = one branch = one fresh Claude Code session = one PR. See `docs/execution-guide.md` for the full loop. Two checkpoints (CP06, CP08) are gated on decisions that must be filled into `docs/decisions.md` first — see the ⚠️ note at the top of those checkpoint files.

Start with `docs/checkpoints/CP00-scaffolding.md`.

## Local development

This is an npm-workspaces monorepo (managed with [Turborepo](https://turborepo.com/)):

```
apps/
  customer/       — Next.js customer-facing app          (port 3000)
  restaurant/      — Next.js restaurant dashboard + KDS    (port 3001)
  api/              — NestJS backend API                    (port 4000)
packages/
  shared-types/    — TypeScript types shared across the above
```

### Prerequisites
- Node.js 24+ and npm 11+
- Docker (for local Postgres)

### First-time setup
```bash
cp .env.example .env      # fill in values as needed; defaults work for local dev
npm install
```

### Running everything
```bash
docker compose up -d                              # starts local Postgres on :5432
npm run db:migrate:deploy --workspace apps/api    # applies migrations
npm run db:seed --workspace apps/api               # seeds the demo restaurant
npm run dev                                        # boots api (:4000), customer (:3000), restaurant (:3001)
```

`npm run dev` uses Turborepo to run every app's `dev` script in parallel, building `packages/shared-types` first so the apps can import it.

If port 5432 is already taken on your machine by something else, change `POSTGRES_PORT` and the port inside `DATABASE_URL` in `.env` together (check `netstat`/`lsof` for what actually owns the port — `docker ps` alone won't show a non-Docker process squatting on it).

### Database (apps/api, Prisma)
```bash
npm run db:migrate --workspace apps/api           # create + apply a migration from schema changes (dev)
npm run db:migrate:deploy --workspace apps/api    # apply existing migrations only (CI/prod-safe)
npm run db:seed --workspace apps/api               # (re-)run prisma/seed.ts — idempotent
npm run db:studio --workspace apps/api             # Prisma Studio, a local DB browser
```
Schema lives at `apps/api/prisma/schema.prisma`; connection config at `apps/api/prisma.config.ts` (reads `DATABASE_URL` from the repo-root `.env` — Prisma 7 does not auto-load `.env` files, so this is explicit).

### Other commands (run from repo root, apply to every workspace)
```bash
npm run build       # production build of every app + package
npm run lint         # lint every workspace
npm run typecheck    # typecheck every workspace
npm run test          # run every workspace's test suite (apps/api's tests hit the real local Postgres — bring it up first)
```

CI (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test` on every PR, with a Postgres service container and a migration step ahead of the test run.

### Scope note
CP0 was infrastructure only. CP1 (`docs/checkpoints/CP01-data-model.md`) adds the core Postgres schema/migrations (Prisma — see `docs/decisions.md`) and a seed script; still no auth or product UI.
