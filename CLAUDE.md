# RAISE — Standing rules for every Claude Code session in this repo

Read this before starting any checkpoint. It applies to every session, every checkpoint, for the life of this project.

## Rule #1 — no blind guessing, ever. Use the right tool for the job.

Before writing a solution from scratch, check what's actually available: installed skills, connected MCP servers, CLI tools, libraries already in this stack. If a specialized skill, tool, or well-established library exists for the thing you're about to hand-roll, use it — don't freehand an implementation of something that already has a correct, maintained answer.

Concretely, in this session:
- List the skills/plugins/MCP tools available to you before deciding your approach for a non-trivial piece of work — not just for the "design" checkpoints, for everything (auth patterns, realtime infra, testing setup, deployment config — all of it).
- If you're about to implement something and you're not confident it's the standard/correct approach, say so and check rather than guessing and moving on.
- Prefer a known-good library/pattern over hand-rolled code for anything security-, auth-, or correctness-critical (tenant isolation, confirmation gating, timing calculations) — these are named as trust boundaries in `docs/production-plan.md` Part 5 for a reason.
- When a checkpoint touches design/UI, cover these four capabilities: drafting the screen, reviewing it for accessibility, writing its UX copy (labels, errors, empty states), and producing a handoff spec. Skill *names* differ between environments — CP3 found that `design:ux-copy`, `design:accessibility-review` and `design:design-handoff` do not exist in every session, while a standalone `accessibility-audit` and a `design` skill with `design-system`/`ui-styling` sub-skills do. So: enumerate your own installed skills, map each capability to the closest real match, and state in `docs/decisions.md` which you used and which had no equivalent. Do not claim a workflow step ran because the plan names it. See `docs/concept-critique.md` and `docs/accessibility-audit.md` for what's already been found on this product's concept screens; don't rediscover those issues from scratch.
- If genuinely no specialized tool/skill fits, say that explicitly, then proceed with your best engineering judgment — "nothing fits, here's my approach and why" is fine; silently guessing without checking is not.

## Rule #2 — work one checkpoint at a time, scoped to its own file

Each checkpoint lives in `docs/checkpoints/CP0N-name.md`. Build exactly what that file specifies, to its "done when" bar — no more, no less. If you think of something extra, note it rather than scope-creeping the current checkpoint.

## Rule #3 — respect the decisions log

`docs/decisions.md` holds every already-locked decision. Read it before starting. Two checkpoints (CP06, CP08) are explicitly blocked until specific entries exist there — check for the ⚠️ note at the top of a checkpoint file before starting it.

## Rule #4 — flag trust boundaries, don't quietly implement around them

Tenant isolation (CP2), explicit customer confirmation before booking (CP5), and menu-grounding with zero hallucination tolerance (CP4) are named as hard boundaries in `docs/production-plan.md` Part 5. If an implementation choice touches one of these, call it out explicitly rather than making a judgment call silently.

## Shared context
- `docs/production-plan.md` — full architecture, data model, stack recommendations.
- `docs/execution-guide.md` — how checkpoints are meant to flow, one branch/session/PR each.
- `docs/concept-critique.md` + `docs/accessibility-audit.md` — known UI/UX issues in the original concept, already found, don't rediscover them.
