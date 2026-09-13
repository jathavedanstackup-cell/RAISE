# CP4 — Voice/chat intake pipeline

Source: `docs/production-plan.md`, Part 6 — the hard checkpoint, budget real time here.

**Deliverables**: streaming ASR integration; LLM dialogue manager with function-calling strictly grounded on the live `MenuItem`/`Table` data (retrieval, not memory); produces an in-progress `Visit` draft (status `draft`) updated turn-by-turn; text-chat fallback for non-voice input.

**Done when**: a scripted test conversation (party size → menu Q&A → order → allergy flag → table proposal → summary read-back) produces a correct structured draft every run; the system never introduces a dish/price not present in `MenuItem`; conversation can handle a mid-flow change of mind.

**Hard rule**: no dish, price, or availability claim may come from model memory — every claim must be grounded in a live `MenuItem` lookup. Treat a hallucinated menu item as a critical bug, not a polish item.

**Recommended split** (per `docs/execution-guide.md` §3): consider doing this as two sub-checkpoints — CP4a (text-chat flow with grounded function-calling, no audio) then CP4b (streaming ASR layered on top) — rather than one large session.

**Unhappy paths to design in, not bolt on later** (per `docs/concept-critique.md`): a correction/edit state ("that's wrong, let me change it"), and an honest "no table available" / "item unavailable" path.

**Open decisions to settle before starting** (per `docs/production-plan.md` Part 8): ASR/LLM provider, grounding strategy (function-calling vs. RAG).

**Depends on**: CP1, CP3 merged.
