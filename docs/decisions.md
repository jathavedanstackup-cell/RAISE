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

## CP2: auth primitives — do not hand-roll
- **Date**: 2026-09-14
- **Affects checkpoint(s)**: CP2 and everything built on staff/customer auth after it
- **Decision**: Password hashing via `argon2` (argon2id). JWT issuance/verification via `@nestjs/jwt`'s `JwtService`, through a hand-rolled `CanActivate` guard (not `passport-jwt`). Phone OTP via Twilio Verify in production, behind an `OtpProvider` interface with a dev-only in-memory stub selected by `OTP_PROVIDER` (default `dev`).
- **Why** (evidence, not just preference):
  - Checked for a fitting skill first, per CLAUDE.md Rule #1: neither the local Vercel Skills repo (`C:\AI-References\skills`) nor `npx skills find` turned up anything for NestJS auth, JWT, or OTP clearing the "1K+ installs, reputable source" bar the repo's own reference-repo guidance sets — best hits were low-install community skills or unrelated pentest/exploit skills (e.g. JWT algorithm-confusion attack skills, not implementation guidance). Falling back to official docs + established libraries, as that same guidance's own fallback path specifies.
  - **Argon2id, not bcrypt**: OWASP's current Password Storage Cheat Sheet recommends Argon2id as the first choice; the `argon2` npm package is actively maintained and its native binding was verified to build and round-trip correctly in this environment before adopting it.
  - **Hand-rolled `CanActivate` guard over `passport-jwt`**: confirmed via Context7 (`/nestjs/jwt`) that NestJS's own current JWT documentation demonstrates exactly this shape — `JwtService.sign`/`.verify` inside a custom guard — without requiring the `passport`/`passport-jwt` dependency chain. Fewer moving parts for the same officially-documented pattern.
  - **Twilio Verify, not the raw Messaging API or a hand-rolled code table**: Verify owns code generation, expiry, resend cooldowns, and brute-force/fraud detection server-side — confirmed via Context7 (`/twilio/twilio-node`) and Twilio's own `twilio/ai@twilio-migrate-messaging-to-verify` skill (found via `npx skills find`, low install count but from Twilio itself), which exists specifically to move people off hand-rolled SMS-code flows and onto Verify. Hand-rolling OTP generation/storage/rate-limiting would be exactly the kind of security-critical primitive Rule #1 says not to freehand.
  - **Separate signing secrets per audience** (`JWT_STAFF_SECRET` / `JWT_CUSTOMER_SECRET`), not one secret plus an `aud` claim each side checks: a leak of the customer-facing secret (a much larger, lower-trust surface — public signup, phone OTP) cannot be used to forge a staff token, and vice versa. This is enforced by `jsonwebtoken`'s own `audience` sign/verify options, not a manual field comparison.

## CP2 Part 8 Q4: phone/OTP provider and guest-first policy
- **Date**: 2026-09-14
- **Affects checkpoint(s)**: CP2 (auth), CP4/CP5 (customer flow assumes a session already exists)
- **Decision**: Twilio Verify is the production phone-OTP provider. **No full account is required before a first booking** — guest-first, per the deck's "you just speak" framing. A verified phone number alone creates a `Customer` row (`phone`, `phoneVerifiedAt`) and issues a customer session token; `name`/`email` stay nullable and are collected later, never gating the first visit.
- **Why**:
  - The deck's explicit selling point is frictionless intake; gating a first booking behind full account creation (password, email verification, etc.) would reintroduce the exact friction RAISE exists to remove.
  - Twilio Verify (see the primitives decision above) was chosen for the same "don't hand-roll" reasoning, and its API shape (`Verifications.create` / `VerificationChecks.create`, keyed by phone number, not by an existing account) fits a guest-first flow naturally — there is no "create account, then verify" step to skip around.
  - Dev-mode stub (`OTP_PROVIDER=dev`, the default): an in-memory `DevOtpProvider` that never calls Twilio, never requires `TWILIO_*` credentials, and logs the code instead of sending it. `OTP_DEV_FIXED_CODE` makes it deterministic for CI. This is what local dev and the CI isolation test both run against — no SMS credits burned, no live provider keys required for `main` to stay green.

## CP2 tenant-isolation enforcement layer: Postgres RLS + Prisma Client Extension, both in depth
- **Date**: 2026-09-14
- **Affects checkpoint(s)**: CP2 and every checkpoint touching restaurant-scoped data after it (CP3, CP6, CP7, CP8, ...)
- **Decision**: Both mechanisms, not one or the other:
  1. **Postgres Row Level Security** on every restaurant-scoped table (`restaurants`, `menu_items`, `tables`, `visits`, `visit_status_events`, `visit_items`, `conversation_turns`, `notification_logs`, `staff_memberships`), with `FORCE ROW LEVEL SECURITY` so even the owning role is subject to it. Policy: a row is visible/writable only if `restaurant_id = current_setting('app.current_restaurant_id', true)`, or an explicit `app.bypass_rls` escape hatch is set (used only by seeding / a future platform-admin path, never by normal request handling).
  2. **A Prisma Client Extension** (`TenantPrismaService.forRestaurant(id, ...)`), following Prisma's own documented pattern (confirmed via Context7 `/prisma/web`), that wraps each request's queries in a transaction and sets that session variable via `set_config` before running them.
  3. **A second, unprivileged Postgres role (`raise_app`)** created by this migration for the app's *runtime* connection (`APP_DATABASE_URL`), distinct from the migration/seed role (`DATABASE_URL`).
- **Why**: the checkpoint's own instruction was explicit — "a rule that must be remembered by every future developer on every future query is not an enforcement layer; prefer the mechanism that fails closed by default." An app-level `WHERE restaurantId = ...` guard alone is exactly that forgettable rule: one missed clause in one future query and it's a leak. RLS is what makes the isolation hold even if that happens.
  - **The second role is not optional, and was not obvious going in.** Before writing any policy, I checked the actual local Postgres role used for migrations (`raise`) and found `rolsuper=t, rolbypassrls=t` — it's a superuser, because the Docker Postgres image's `POSTGRES_USER` bootstrap account always is, in both local dev and this project's CI service container. Superusers bypass RLS unconditionally, regardless of `FORCE ROW LEVEL SECURITY` — so if the running API had kept connecting as `raise`, every policy in this migration would have been silently inert, and the isolation test would only have been passing because of the application-level `WHERE` clauses it's specifically meant not to depend on. Verified the fix directly with `psql` before writing any application code: as `raise_app` with no session variable set, a known-existing row returns zero results; with the matching `app.current_restaurant_id` set, it returns exactly that row.
  - Flagging per CLAUDE.md Rule #4: this DB-role split is new infrastructure this checkpoint introduces, not something CP0/CP1 anticipated. `docker-compose.yml` needed no changes (the role is created by a migration, not compose), but `.env`/`.env.example`/CI/`turbo.json` all needed a new `APP_DATABASE_URL` alongside `DATABASE_URL`.
  - **Known limitation, explicitly not swept under the rug**: the migration creates `raise_app` with a fixed, non-secret placeholder password (matching this repo's existing `raise`/`raise` dev-credential convention), because Prisma migrations are static SQL checked into git and can't read a per-environment secret at apply time. This is fine for local dev and CI's ephemeral database, but **any real deployment must rotate this role's password out-of-band** (`ALTER ROLE raise_app WITH PASSWORD '...'`, via infra provisioning/secrets manager, not a migration) before go-live. This belongs to CP12 (launch readiness / security hardening) as an explicit line item, not something to assume CP2 already handled.
  - `users` and `customers` are deliberately **not** RLS-scoped: they're global identity tables (a staff user can hold memberships at more than one restaurant via `staff_memberships`; a customer isn't owned by any single restaurant). RLS applies to restaurant-owned data, not identity.

## CP2 staff <-> restaurant shape: membership join table, not a flat column
- **Date**: 2026-09-14
- **Affects checkpoint(s)**: CP2, CP13 (Phase 2 chains)
- **Decision**: `StaffMembership` (userId x restaurantId x role), not a `restaurantId`/`role` column pair on `User` itself. Roles: `owner`, `foh`, `kitchen` — matching CP2's deliverable exactly. No chain-management features are built now; this is purely a schema-shape choice made once, up front.
- **Why**: Part 2.3's whole argument for building multi-tenant from day one is that retrofitting is expensive; CP13 explicitly brings "one owner, many locations." A flat column is a 1:1 user-to-restaurant shape that would need an actual data migration (moving existing rows into a new join table) the day a single owner needs to manage a second location. The join table costs nothing extra at v1's one-restaurant scale (a `@@unique([userId, restaurantId])` and an index) and needs no migration when chains arrive — just more rows.
