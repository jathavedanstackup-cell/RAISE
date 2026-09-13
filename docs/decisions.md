# Locked decisions

Append one entry per decision below — do not delete or rewrite history, only add. Each Claude Code checkpoint session should be pointed at this file so it never re-guesses something already settled.

Format per entry:

```
## <short title>
- **Date**:
- **Affects checkpoint(s)**:
- **Decision**:
- **Why** (evidence, not just preference):
```

---

<!-- Two decisions are already known to be pending, per docs/execution-guide.md §4 — fill these in once the restaurant interviews from docs/user-research-plan.md happen, and do not start CP6 or CP8 until they're filled in:

## Kitchen auto-start vs. staff accept-step
- Affects checkpoint(s): CP6, CP8
- Decision: TBD — pending restaurant interviews
- Why: TBD

## Allergy flag: passive display vs. staff acknowledgment
- Affects checkpoint(s): CP8
- Decision: TBD — pending restaurant interviews
- Why: TBD

-->

## ORM / migration tool: Prisma (v7, pinned)
- **Date**: 2026-09-13
- **Affects checkpoint(s)**: CP1 (and every checkpoint that touches the schema after)
- **Decision**: Use Prisma ORM for the data model, migrations, and seed script. Pin `prisma` and `@prisma/client` to matching `^7.10.0` — not `latest`.
- **Why** (evidence, not just preference):
  - Checked what's actually available before choosing (per CLAUDE.md Rule #1) rather than defaulting to whichever ORM is most familiar:
    - `npx skills find prisma` (via the Vercel Skills reference repo) surfaces `prisma/skills` — an **official**, actively maintained skill suite (`prisma-postgres-setup`, `prisma-cli`, `prisma-client-api`, `prisma-driver-adapter-implementation`, …) each with 265K–282K installs.
    - `npx skills find drizzle` surfaces only third-party community skills, the best at ~4.8K installs — no official `drizzle-team` skill exists. Per the find-skills quality bar (prefer 1K+ installs and official sources), Prisma has a clear, verifiable edge here, not just a popularity impression.
    - Confirmed current docs for both via Context7 (`/prisma/web`, `/drizzle-team/drizzle-orm-docs`): both handle Postgres native enums, array columns, and a migrate-from-empty-db workflow competently. Drizzle is lighter/closer to raw SQL; Prisma's declarative `schema.prisma` + relations map directly onto Part 3's FK-heavy shape (Restaurant → MenuItem/Table/Visit → VisitItem/ConversationTurn/NotificationLog), and its built-in `db seed` convention is a direct fit for CP1's "seed script with one demo restaurant" deliverable without extra tooling.
  - **Version pin, not "latest"**: `npm view prisma version` resolves to `8.0.0-rc.14` (a release candidate) while `npm view @prisma/client version` resolves to `7.10.0` (stable) — those two do not work together. Installing "latest" naively would silently pull a mismatched, pre-release CLI against a stable client. Pinned both to `^7.10.0` instead — the last fully-stable, matched pair — rather than riding an RC on the project's very first migration.
  - Integration pattern: a hand-written `PrismaService` (extends `PrismaClient`, implements `OnModuleInit`/`OnModuleDestroy`) per NestJS's own official docs, not the third-party `nestjs-prisma` wrapper package — no need for the extra dependency at this scale.

## CP1 schema shape: deviations from Part 3's literal sketch, flagged per Rule #4
- **Date**: 2026-09-13
- **Affects checkpoint(s)**: CP1 (schema), CP2 (tenant isolation), CP6 (timing engine), CP8 (kitchen display)
- **Decision**: Three modelling choices go beyond, or diverge from, Part 3's literal ASCII schema. Flagging explicitly rather than deciding silently, per CLAUDE.md Rule #4 and this checkpoint's own instruction:
  1. **`restaurant_id` denormalized onto every child table**, not just the tables Part 3 lists it on directly. Part 3 only shows `restaurant_id` on `MenuItem`/`Table`/`Visit`; `VisitItem`, `ConversationTurn`, `NotificationLog`, and `VisitStatusEvent` (below) got it too, plus a matching `@@index([restaurantId])`.
  2. **`VisitStatusEvent` — a new, separate append-only table** for `Visit.status` transitions, rather than more flat timestamp columns on `Visit` (Part 3 shows `arrival_confirmed_at`/`table_assigned_at` as flat columns and only says "timestamps for every status transition" in prose, without picking a shape). The CP1 prompt explicitly allowed either ("first-class column/row"); chose the table because it's genuinely append-only (a status can be revisited without a migration) and because CP6's "recompute kitchen_start_time on ETA drift" is naturally "insert another event," not "overwrite a column."
  3. **`VisitItem.modifications` modeled as fully structured (`String[]`), not "free-form + structured tags"** as Part 3's prose literally says. The CP1 prompt's own instruction ("Allergens and modifications are STRUCTURED tags, not free text") is more specific and more recent than Part 3's general description, so it took precedence per CLAUDE.md's authority order (explicit task instructions over project docs). There is currently no free-text notes field on `VisitItem` — if a later checkpoint needs one (e.g. a customer's genuinely unstructured aside), that's a deliberate addition then, not an oversight now.
- **Why**: (1) is the concrete mechanism CP2's tenant-isolation checks (app-level guards and/or Postgres RLS) need — without it, isolating `VisitItem`/`ConversationTurn`/etc. requires a join back through `Visit` on every check, which is slower and awkward for RLS `USING` clauses. (2) and (3) are both about keeping the kitchen-facing data (timing history, allergy/modification flags) structured and machine-renderable rather than prose, which is the explicit point of CP6 and CP8.
