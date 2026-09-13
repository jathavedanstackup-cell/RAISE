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
