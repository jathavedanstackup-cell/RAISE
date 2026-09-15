# RAISE — Before You Arrive
## Production Application Plan (End-to-End)

Source: `RAISE_-_Before_You_Arrive.pptx` (product vision deck, 9 slides)

This document turns the vision deck into a buildable, production-grade system. It is organized so it can be handed to Claude Code **one checkpoint at a time** — each checkpoint in Part 6 is scoped to be independently implementable, testable, and mergeable, with explicit inputs, outputs, and acceptance criteria.

---

## Part 1 — Product Definition

### 1.1 One-line description
RAISE lets a customer complete an entire restaurant visit — table, food, and timing — by voice while they are still traveling to the restaurant, so the kitchen and the table are ready at the moment they walk in.

### 1.2 What RAISE is
- A voice/chat intake layer grounded in a specific restaurant's real, live menu (dishes, prices, current availability, substitutions).
- A structured "visit" object — party size, arrival time, table, order, allergies/modifications — created before arrival and confirmed by the customer before anything is booked.
- A restaurant-facing system that converts that visit into a timed kitchen and floor plan: table hold, prep start time, food-out target.

### 1.3 What RAISE explicitly is not (from the deck — keep as hard boundaries)
- Not a delivery app — food is eaten at the restaurant, order fulfillment ends at the table.
- Not a bookings-only tool — a table reservation with no food/timing plan is not a completed RAISE visit.
- Not a phone replacement — it does not just capture a message; it produces a structured, actionable plan the kitchen can time itself against.

### 1.4 Core numbers the product is built around (from the deck's scenario)
- Customer decides in the car ~25 minutes before arrival; today the restaurant only finds out at the door.
- Baseline walk-in-to-eating time: 37 minutes (wait for table 6 + menus 5 + decide/order 7 + wait for food 19).
- Target with RAISE: ~5 minutes from walking in to sitting down at a table with food already in progress (kitchen start time = arrival time − prep duration, e.g. table 11, order in at 7:52, kitchen starts 7:58, food out 8:18, guests arrive 8:15).
- These numbers become the acceptance criteria for the timing engine in Part 6 (CP6): given an arrival ETA and a dish's known prep time, compute a kitchen start time and food-out target, and keep the visit's state machine honest against clock drift (customer running late/early).

### 1.5 Primary users
1. **Customer (guest)** — talks to RAISE by voice or chat while traveling; browses real menu; orders; flags allergies; books table; must explicitly confirm before anything is booked ("nothing is booked until you say yes").
2. **Restaurant staff — front of house** — sees inbound visits on a timeline (who, when, table, party size, high chair needs), confirms/adjusts table assignment.
3. **Restaurant staff — kitchen** — sees a prep queue driven by arrival time, not order-in time; gets structured allergy/modification flags, not free text on a pad.
4. **Restaurant admin/owner** — onboards the restaurant, manages the menu structured data, table inventory, and (Phase 2) views analytics across locations.

### 1.6 Non-goals for v1 (defer to Phase 2/3, matching deck slide 9's "start with one restaurant" framing)
- Multi-location chain rollout and chain-wide analytics.
- Deep POS/reservation-system integrations (OpenTable, Toast, Square, etc.) — v1 ships as a standalone system a single restaurant runs alongside its existing tools.
- Payment collection at booking time (v1 does not take payment; pay-at-restaurant as today).
- Full accessibility/localization polish beyond WCAG 2.1 AA baseline.

---

## Part 2 — System Architecture

### 2.1 High-level shape

```
┌─────────────────┐        voice/chat         ┌──────────────────────┐
│  Customer client │ ───────────────────────▶ │  Intake / NLU service │
│ (mobile web, PWA)│ ◀─────────────────────── │ (speech + dialogue)   │
└─────────────────┘     confirmed visit JSON   └──────────┬────────────┘
                                                            │
                                                            ▼
                                                 ┌─────────────────────┐
                                                 │   Core API / Visit   │
                                                 │   & Timing Engine    │
                                                 └──────────┬───────────┘
                                                            │ writes
                                    ┌───────────────────────┼───────────────────────┐
                                    ▼                       ▼                       ▼
                          ┌────────────────┐     ┌──────────────────┐   ┌───────────────────┐
                          │   Postgres      │     │  Realtime bus     │   │  Notification svc  │
                          │ (visits, menus, │     │ (WS / pub-sub)     │   │ (SMS/push/email)   │
                          │  tables, orgs)  │     └────────┬──────────┘   └────────────────────┘
                          └────────────────┘              │
                                                            ▼
                                                 ┌─────────────────────┐
                                                 │ Restaurant dashboard │
                                                 │ + Kitchen display    │
                                                 └─────────────────────┘
```

### 2.2 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend (customer) | Next.js (React) PWA, mobile-first, voice via Web Speech API + fallback push-to-talk | Works hands-free in a car scenario without a native app install; installable as PWA later |
| Frontend (restaurant dashboard + KDS) | Next.js, same monorepo, separate app shell | Shared design system and API client with customer app |
| Backend API | Node.js (NestJS) or Python (FastAPI) — pick one, NestJS recommended for shared TS types with frontend | Strong typing end-to-end, good WebSocket support |
| Database | PostgreSQL (managed — e.g. Supabase or RDS) | Relational integrity for visits/tables/timing; JSONB for flexible menu schema |
| Realtime | WebSocket (native or Supabase Realtime / Pusher / Ably) | Restaurant dashboard and KDS must update the instant a visit is confirmed or timing shifts |
| Voice pipeline | Streaming ASR (Deepgram or OpenAI Realtime API) → LLM dialogue manager grounded on restaurant menu (RAG over structured menu, not free text) → structured "visit draft" object | Must be low-latency (hands-free, in-car) and must ground every claim in the restaurant's real, current menu — never let the LLM invent a dish or price |
| LLM/dialogue | Claude (or GPT) with function-calling against a strict menu schema; every turn re-validates against live menu/availability | Prevents hallucinated dishes; enables "ask questions, change your mind" per deck slide 5 |
| Notifications | Twilio (SMS) + web push | Confirms booking to customer, alerts restaurant of new inbound visit |
| Auth | Auth.js / Clerk for customer (phone-based, low friction); restaurant staff auth with roles (owner/FOH/kitchen) | Two very different auth needs — keep them as separate flows |
| Infra | Docker Compose for local dev; single-region managed Postgres + container hosting (Fly.io/Render/AWS ECS) for v1 | Multi-tenant-ready from day one even though v1 launches with one restaurant |
| Observability | OpenTelemetry traces, structured logs, Sentry for errors | Voice pipeline failures must be traceable per-turn |

### 2.3 Multi-tenancy stance
Build the data model multi-tenant from day one (every table scoped by `restaurant_id`) even though v1 onboards a single restaurant — this is far cheaper than retrofitting before the Phase-2 "chains" push (deck slide 9) and costs almost nothing at v1 scale.

---

## Part 3 — Core Data Model

```
Restaurant
  id, name, timezone, address, phone, settings (avg prep buffer, table-hold window)

MenuItem
  id, restaurant_id, name, description, price, prep_time_minutes,
  allergens[], modifiable_options[] (e.g. spice level), available (bool), category

Table
  id, restaurant_id, label, seats_min, seats_max, status (free/held/seated), features[] (high_chair_ok, etc.)

Visit                         -- the central object
  id, restaurant_id, customer_id,
  party_size, has_child (bool), special_needs (high_chair, etc.),
  arrival_eta, arrival_confirmed_at,
  table_id (nullable until assigned), table_assigned_at,
  status: enum [
    draft,            -- mid-conversation, not yet confirmed by customer
    confirmed,         -- customer said yes; table held
    kitchen_started,
    table_set,
    guest_arrived,
    food_out,
    completed,
    cancelled, no_show
  ],
  timestamps for every status transition (audit trail == the timeline shown in slide 6/8)

VisitItem
  id, visit_id, menu_item_id, quantity, modifications[] (free-form + structured tags), allergy_flags[]

ConversationTurn               -- raw voice/chat log, linked to a Visit draft
  id, visit_id, role (customer/system), transcript, structured_delta (JSON patch applied to the draft), created_at

NotificationLog
  id, visit_id, channel, payload, sent_at, status
```

Design notes:
- `Visit.status` transitions are the actual product: every timestamp in the deck (7:50 decide → 7:52 order → 7:58 kitchen start → 8:15 arrive → 8:18 food out) is a state transition with a timestamp, not a free-text note. This is what CP6 (timing engine) and CP8 (kitchen display) are built against.
- Allergies/modifications are **structured tags**, not just free text, specifically so the kitchen display can highlight them (per deck: "No peanuts anywhere on this table" rendered as a flagged line, not buried in a sentence).
- `MenuItem.prep_time_minutes` is what lets the timing engine compute `kitchen_start_time = arrival_eta − max(prep_time_minutes across ordered items) − buffer`.

---

## Part 4 — Key Functional Flows

### 4.1 Customer flow (voice-first)
1. Customer opens the PWA (or a restaurant-specific link/QR/number) while en route.
2. Voice/chat session starts; system greets with restaurant name, asks party size and rough arrival time.
3. Dialogue manager walks the live menu with the customer — customer can ask questions, get recommendations, change their mind (deck: "the way you would with a waiter").
4. System proposes a table (from live table inventory + party size + ETA).
5. System reads back a structured summary: guests, table, order, allergies, arrival time.
6. **Explicit confirmation required** — nothing is written to `confirmed` status until the customer says yes. This is a hard product rule, not just copy — enforce it at the API layer (a `POST /visits/:id/confirm` call gated on an explicit customer action, never inferred from conversation sentiment).
7. Customer receives an SMS/push confirmation with visit details and a live ETA-update link (if running later/earlier, they can update ETA without a new full conversation).

### 4.2 Restaurant flow
1. New confirmed visit appears instantly (WebSocket push) on the FOH dashboard's "Tonight — Inbound" timeline, sorted by arrival time.
2. Table auto-held; staff can override table assignment.
3. At the computed kitchen-start time, the item appears on the kitchen display queue with allergy/modification flags surfaced prominently (not buried in prose).
4. Staff mark stages complete (table set, food out) — these updates flow back to a live ETA/status the customer can optionally see.
5. If the customer's ETA drifts (they update it, or a "running late" signal), the timing engine recomputes kitchen start and pushes an update to the kitchen display — this recompute-on-drift behavior is itself a checkpoint (CP6) acceptance criterion, not an afterthought.

### 4.3 Failure / edge paths to design for explicitly (do not leave implicit)
- Customer never confirms (drafts abandoned) — table hold auto-expires after a configurable window.
- Customer arrives significantly early/late — timing engine recompute, and a staff-visible alert if drift exceeds a threshold.
- Item goes unavailable between order and kitchen start — needs a re-confirmation micro-flow with the customer (SMS: "we're out of X, swap to Y?").
- No table available for requested time/party size — system must say so honestly during the conversation, not overpromise (matches deck's "nothing is booked until you say yes").
- Restaurant is closed / outside hours — conversation should not proceed to booking.

---

## Part 5 — Non-Functional Requirements

- **Latency**: voice turn-around (speech end → system response start) under ~1.5s to feel conversational while driving hands-free; this constrains ASR/LLM provider choice (streaming, not batch).
- **Reliability of the confirmation boundary**: a visit must never reach `confirmed` status without an unambiguous, logged customer confirmation — this is a trust/legal boundary as much as a UX one.
- **Data correctness over cleverness in the menu grounding**: the dialogue manager must only ever reference items/prices/availability from the live `MenuItem` table (via function-calling / retrieval), never from model memory — hallucinated dishes or prices are a hard failure class, not a polish item.
- **Accessibility**: WCAG 2.1 AA on both customer and restaurant-facing UIs (run `design:accessibility-review` during design handoff for each screen — see Part 7).
- **Security/privacy**: allergy data is sensitive-adjacent (food safety, not medical diagnosis) — treat as required-accurate, access-scoped to restaurant staff, never used for anything but kitchen prep; standard PII handling (phone numbers) with clear retention policy.
- **Multi-tenant isolation**: every query scoped by `restaurant_id`; no cross-tenant data leakage, enforced at the ORM/query layer, tested explicitly (CP2).
- **Auditability**: every `Visit` status transition timestamped and immutable (append-only transition log) — this is also what powers the "37 min → 5 min" before/after metric the product's own value proposition depends on.

---

## Part 6 — Build Checkpoints (hand to Claude Code one at a time)

Each checkpoint below is scoped to be a self-contained PR: clear inputs, deliverables, and a "done when" bar. Work them in order — later checkpoints assume earlier ones exist. Suggested framing when handing a checkpoint to Claude Code: paste the checkpoint block verbatim as the task, plus a pointer back to Parts 2–5 of this document for shared context (data model, NFRs).

### CP0 — Repo & infra scaffolding
**Deliverables**: monorepo structure (customer app, restaurant app, API, shared types package), Docker Compose for local Postgres, CI pipeline (lint/typecheck/test on PR), environment config pattern (`.env.example`), base README.
**Done when**: `docker compose up` gives a working local Postgres; `npm run dev` boots API + both frontends; CI passes on an empty/scaffold commit.

### CP1 — Core data model & migrations
**Deliverables**: Postgres schema/migrations for `Restaurant`, `MenuItem`, `Table`, `Visit`, `VisitItem`, `ConversationTurn`, `NotificationLog` per Part 3; seed script with one demo restaurant + menu + tables (use the deck's own "Spice Route" example data as seed fixtures).
**Done when**: migrations run clean from empty DB; seed script produces a queryable demo restaurant; basic CRUD covered by tests for each table.

### CP2 — Multi-tenant auth & roles
**Deliverables**: restaurant staff auth (owner/FOH/kitchen roles) scoped to `restaurant_id`; customer auth (phone-based, low-friction, can start a session before full signup); tenant-isolation middleware/query guards.
**Done when**: a staff user from Restaurant A cannot read/write Restaurant B's data (explicit isolation test); role checks enforced on every restaurant-side endpoint.

### CP3 — Menu management API + admin UI
**Deliverables**: CRUD API for `MenuItem` (including `prep_time_minutes`, `allergens`, `available`); minimal admin screen for restaurant owner to manage the menu.
**Done when**: owner can add/edit/disable a dish and it's immediately reflected in what the intake pipeline (CP4) can reference.

### CP4 — Voice/chat intake pipeline (the hard checkpoint — budget real time here)
**Deliverables**: streaming ASR integration; LLM dialogue manager with function-calling strictly grounded on the live `MenuItem`/`Table` data (retrieval, not memory); produces an in-progress `Visit` draft (status `draft`) updated turn-by-turn; text-chat fallback for non-voice input (deck: "Listening — or type").
**Done when**: a scripted test conversation (party size → menu Q&A → order → allergy flag → table proposal → summary read-back) produces a correct structured draft every run; the system never introduces a dish/price not present in `MenuItem`; conversation can handle a mid-flow change of mind.

### CP5 — Confirmation & booking flow
**Deliverables**: explicit `POST /visits/:id/confirm` endpoint gated on unambiguous customer confirmation; table hold logic on confirm; hold auto-expiry for abandoned drafts; customer-facing confirmation screen/SMS.
**Done when**: no code path can set `Visit.status = confirmed` without passing through the explicit confirm action; abandoned drafts release their table hold after the configured window.

### CP6 — Timing engine
**Deliverables**: `kitchen_start_time` and `food_out_target` computation from `arrival_eta` + ordered items' `prep_time_minutes`; recompute-on-drift when a customer updates ETA; the full status-transition timestamp log described in Part 3.
**Done when**: given the deck's own scenario numbers (order in 7:52, arrival 8:15, kitchen start 7:58, food out 8:18) as a test fixture, the engine reproduces those exact times; an ETA update after confirmation correctly shifts kitchen start and emits a realtime event.

### CP7 — Restaurant FOH dashboard
**Deliverables**: "Tonight — Inbound" live timeline (per deck slide 6) showing party size, arrival, table, order summary, allergy flags; realtime updates via WebSocket on new/changed visits; manual table reassignment.
**Done when**: a new confirmed visit appears on the dashboard within ~1s without a page refresh; staff can reassign a table and it persists.

### CP8 — Kitchen display system (KDS)
**Deliverables**: prep queue ordered by computed `kitchen_start_time` (not order-in time); allergy/modification flags rendered as prominent, scannable tags (not prose); stage-completion controls (food out, etc.).
**Done when**: items appear on the KDS at their computed start time, not before; an allergy flag is visually impossible to miss in a usability pass.

### CP9 — Notifications
**Deliverables**: SMS/push confirmation to customer on booking; restaurant-side alert on new inbound visit; drift-alert to staff if a customer's ETA changes significantly post-confirmation.
**Done when**: each event type reliably fires exactly once (idempotency test — no duplicate SMS on retry/reconnect).

### CP10 — Design QA & accessibility pass
**Deliverables**: run `design:accessibility-review` against both the customer and restaurant/kitchen UIs; run `design:design-critique` on the dashboard and KDS specifically (information density, hierarchy under time pressure); fix findings.
**Done when**: WCAG 2.1 AA passes on both UIs; critique findings triaged and either fixed or explicitly deferred with reason.

### CP11 — Observability & admin tooling
**Deliverables**: structured logging + tracing across the voice pipeline (per-turn latency, ASR/LLM error rates); Sentry error tracking; an internal admin view of live visits across the system for support/debugging.
**Done when**: a failed voice turn is traceable end-to-end from a single log/trace query; error rate dashboards exist.

### CP12 — Launch readiness / security hardening
**Deliverables**: rate limiting on intake endpoints; secrets management review; data retention policy implementation (conversation transcripts, PII); load test of the confirm+realtime path at expected single-restaurant peak (dinner rush concurrency).
**Done when**: security checklist signed off; load test meets target latency under peak concurrent visits for one restaurant.

### CP13 (Phase 2, not v1) — POS/reservation integrations & multi-location
**Deliverables**: adapter pattern for external POS/reservation systems (Toast, OpenTable, Square, etc.); chain-level admin/analytics (deck slide 9's "later — their systems" and "then — chains").
**Done when**: at least one real POS integration round-trips a visit; a chain owner can view aggregated visit/timing metrics across locations.

---

## Part 7 — Design Workflow for UI Checkpoints

For any checkpoint that produces a new customer- or restaurant-facing screen (CP4's confirmation summary UI, CP7 dashboard, CP8 KDS), route the design step through the installed design skills rather than hand-rolling layout ad hoc:
**Skill names are not portable between environments.** CP3 found that `design:ux-copy`, `design:accessibility-review` and `design:design-handoff` don't exist in every session, while a standalone `accessibility-audit` skill and a `design` skill with `design-system`/`ui-styling` sub-skills do. Treat the four items below as *capabilities to cover*, not slugs to invoke: enumerate what's actually installed, map each to its closest real match, and record in `docs/decisions.md` which ran and which had no equivalent. Never report a step as done because the plan names it.

- a canvas/drafting skill to draft the screen.
- an accessibility review before calling a screen done — this system is used hands-free while driving (customer side) and under time pressure in a kitchen (KDS side); both are accessibility-critical contexts, not optional polish.
- a UX-copy pass for the confirmation read-back and error/empty states (e.g. "no table available for that time" must be honest, not evasive, per the deck's own "nothing is booked until you say yes" principle). If no skill covers this, write the copy deliberately against `docs/concept-critique.md` and say so.
- a handoff spec once a screen is approved, for the checkpoint to build against.

---

## Part 8 — Open Questions to Resolve Before CP4

These materially affect the hardest checkpoint (voice intake) and are worth deciding explicitly rather than defaulting silently:
1. ASR/voice provider choice (Deepgram vs. OpenAI Realtime vs. other) — affects latency and cost per conversation.
2. Which LLM powers the dialogue manager, and whether function-calling grounding is enforced via strict schema validation or a retrieval-augmented prompt — this is the single biggest hallucination-risk surface in the product.
3. Table-hold expiry window and re-confirmation policy on item unavailability — product/business decision, not just engineering.
4. Phone-based customer auth provider and whether a full account is required before a first booking, or a guest flow is allowed (deck's frictionless "you just speak" framing argues for guest-first).
