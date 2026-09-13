# RAISE — Execution Guide
## How to actually run the checkpoints through Claude Code, efficiently, as a solo builder

This ties together the three other documents (`RAISE_production_plan.md`, `RAISE_user_research_plan.md`, `RAISE_concept_critique.md` + `RAISE_concept_accessibility_audit.md`) into an operating procedure. Read this once, then reuse it as the loop for every checkpoint.

---

## 1. The repo is the source of truth, not the chat history

Before CP0 even starts, create the repo and drop all four documents into it (e.g. `/docs/`). Every Claude Code session for every checkpoint starts fresh with no memory of this conversation — it only knows what's in the repo. So:

- `docs/production-plan.md`, `docs/user-research-plan.md`, `docs/concept-critique.md`, `docs/accessibility-audit.md` — committed on day one.
- A single `docs/decisions.md` file that starts empty and grows by one entry per decision you lock (see §4) — this is what stops a later checkpoint from silently re-litigating something you already settled.
- A `docs/checkpoints/` folder with one file per checkpoint (`CP00-scaffolding.md`, `CP01-data-model.md`, ...), each containing that checkpoint's block copied straight out of the production plan. This is what you'll actually hand to Claude Code, not the whole plan document — a fresh session doesn't need CP6-CP13 context to do CP1.

## 2. One checkpoint = one branch = one Claude Code session = one PR

Don't run multiple checkpoints in one long session, and don't let one session's context bleed into the next by relying on chat memory. The pattern per checkpoint:

1. `git checkout -b cp01-data-model` (branch name matches the checkpoint file).
2. Open a **new** Claude Code session in that branch.
3. Give it a prompt built from three things, in this order:
   - The specific checkpoint file (`docs/checkpoints/CP01-data-model.md`) — what to build, done-when criteria.
   - `docs/decisions.md` — anything already locked that this checkpoint must respect (e.g. if CP-before-this locked "table hold expiry = 30 min," CP1's schema needs a column for it).
   - The relevant slice of the production plan's shared context (Part 2 architecture + Part 3 data model) — not the whole document, just the parts this checkpoint touches.
4. Let it work to the "done when" bar stated in the checkpoint. Don't move the goalposts mid-session — if you think of something extra, write it as a new line in the *next* checkpoint's file instead of scope-creeping the current one.
5. Review the PR yourself against the "done when" criteria before merging — treat that line as the actual acceptance test, not a suggestion.
6. Merge, delete the branch, move to the next checkpoint file.

This keeps every Claude Code session small, focused, and re-runnable — if CP4 goes sideways, you throw away that branch and start CP4 again with a fresh session, without having polluted CP1-CP3's already-merged work.

## 3. Sizing sessions realistically

Not every checkpoint is one sitting. Rough sizing, so you know what to expect going in:

| Checkpoint | Realistic effort |
|---|---|
| CP0 scaffolding | Half a day |
| CP1 data model | Half a day — mechanical once the schema in the production plan is settled |
| CP2 auth/multi-tenant | 1 day — isolation testing takes real care |
| CP3 menu CRUD | Half a day |
| CP4 voice/chat intake | **2-4 days, likely multiple Claude Code sessions** — this is the hard checkpoint named in the plan; consider splitting it into CP4a (text-chat flow with grounded function-calling, no audio yet) and CP4b (streaming ASR layered on top) as two branches rather than one, so a stuck voice-provider integration doesn't block the dialogue-manager logic underneath it |
| CP5 confirmation/booking | Half a day — but review the "done when" test (no code path can confirm without the explicit action) especially carefully, it's a trust boundary |
| CP6 timing engine | 1 day, **but do not start until the CP6 decision in §4 below is locked** |
| CP7 FOH dashboard | 1-2 days |
| CP8 kitchen display | 1 day, **but do not start until the CP8 decision in §4 below is locked**, and feed it the "realistic volume" mock from the concept critique, not the deck's 3-row version |
| CP9 notifications | Half a day |
| CP10 design/a11y QA pass | 1 day — mostly re-running `design:accessibility-review` against real screens, since the concept-level pass (already done) only cleared color contrast, not keyboard/touch/ARIA |
| CP11 observability | Half a day |
| CP12 launch hardening | 1-2 days, don't rush this one |
| CP13 (Phase 2) | Not now — explicitly out of scope until v1 is live with one restaurant |

Total realistic v1 timeline for one person working part-time around a day job: **4-6 weeks**, dominated by CP4. Budget for that up front rather than being surprised by it mid-build.

## 4. The two decisions that must be locked before CP6 and CP8 — don't skip this

The user-research plan named exactly two architecture forks that depend on real evidence, not preference:

- **CP6**: does the kitchen auto-start on a confirmed visit with no human accept step (as currently designed), or does it need a staff-side accept step first? Depends on what your 3-4 restaurant interviews say about trust.
- **CP8**: does the allergy flag just display, or does it need an explicit staff acknowledgment step? Same dependency.

**Do not start CP6 or CP8 until you've written the answer into `docs/decisions.md`.** One paragraph each is enough: what you heard, what you decided, and the date. This is cheap insurance against building CP6 one way, hearing contrary restaurant feedback in interview #3, and having to redo it.

Everything else (CP0-CP5, CP7, CP9-CP12) can proceed in parallel with or ahead of finishing the interviews — they don't depend on the research.

## 5. Efficient prompting pattern for Claude Code, per checkpoint

A good checkpoint prompt to Claude Code is short and points at files rather than re-explaining context:

> Build CP0<N> as specified in `docs/checkpoints/CP0<N>-<name>.md`. Respect any relevant entries in `docs/decisions.md`. Shared architecture/data-model context is in `docs/production-plan.md` Parts 2-3 if needed. Stop and ask if the "done when" criteria are ambiguous — don't guess on the trust-boundary behaviors (explicit confirmation, tenant isolation) called out in that checkpoint.

That last sentence matters: CP2 (tenant isolation) and CP5 (explicit confirm) are exactly the two checkpoints where a guessed shortcut is the most expensive kind of bug to find later. Flag that explicitly rather than trusting it to infer priority from the spec alone.

## 6. What "efficient" actually means here, given your constraints

Efficient does not mean fastest wall-clock time — it means not redoing work. The three biggest redo-risks, all already addressed by the docs you have:
1. Building CP6/CP8 before the trust-model decision is locked (§4).
2. Letting CP4 sprawl into one giant session instead of splitting text-flow from voice-layer (§3).
3. Designing CP7/CP8's UI against the deck's best-case 3-row mockup instead of the realistic-volume version flagged in the concept critique — building the dashboard once against real density is cheaper than building it pretty and redoing the layout once real dinner-rush volume breaks it.
