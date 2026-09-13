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
docker compose up -d      # starts local Postgres on :5432
npm run dev                # boots api (:4000), customer (:3000), restaurant (:3001)
```

`npm run dev` uses Turborepo to run every app's `dev` script in parallel, building `packages/shared-types` first so the apps can import it.

### Other commands (run from repo root, apply to every workspace)
```bash
npm run build       # production build of every app + package
npm run lint         # lint every workspace
npm run typecheck    # typecheck every workspace
npm run test          # run every workspace's test suite
```

CI (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, and `test` on every PR.

### Scope note
CP0 is infrastructure only — each app is a placeholder page proving the wiring (dev server, shared types, lint/typecheck/test) works end to end. No data model, auth, or product UI yet; those start at CP1 (`docs/checkpoints/CP01-data-model.md`).
