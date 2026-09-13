# RAISE — User Research Plan
## Sized to what one person can actually run, before the architecture gets locked

This is deliberately **not** a corporate research plan. You are one person, pre-partnership with any restaurant, with a day job and no research budget or participant panel. Running the textbook version of this (8 moderated interviews + a usability lab + a 100-person survey, 4 weeks) would just stall the project. The point of this document is to size the research to what's realistically achievable solo, in about a week to ten days, while still answering the questions that actually change the architecture in `RAISE_production_plan.md`.

If a finding here doesn't change a decision in that plan, it's not worth researching yet — better spent building CP0–CP3.

---

## 1. Why research before locking architecture — what's actually at stake

Part 8 of the production plan named four open questions. Not all of them are research questions — some are vendor/engineering decisions you can just make. Splitting them out:

**Genuinely needs evidence from real people (research questions):**
- Will a customer actually talk to their phone, hands-free, to plan a restaurant visit while driving — or does that feel awkward/unsafe/weird in practice, versus just typing while stopped at a light or before leaving the house?
- Will a restaurant (specifically: an independent restaurant owner/manager, not a chain) trust a structured allergy/order plan from a system they don't control, enough to actually start cooking against it before the guest arrives? This is the single biggest adoption risk in the whole product — the entire value proposition (CP6's timing engine) is worthless if kitchens won't act on it.
- Is "nothing is booked until you say yes" actually how people want to interact, or do they want the system to just book it and let them cancel/change after? (Changes the confirmation UX in CP5.)
- Table-hold expiry window — this is really "how flaky are real dinner plans," which is an empirical question about your actual target users, not a guess.

**Vendor/engineering decisions — do NOT research these, just decide them:**
- ASR/LLM provider choice.
- Grounding strategy (function-calling vs. RAG).
These are implementation details a user has no opinion on. Deferring them to "after research" would be over-researching.

So the research plan below is scoped to the first four questions, on two sides: the customer side and the restaurant side. The restaurant side matters more and should get more of your limited time — a system customers love but no restaurant will run is dead on arrival.

---

## 2. Method selection — what's realistic for you specifically

| Method (from the skill's table) | Use it? | Why / why not |
|---|---|---|
| User interviews | **Yes — core method** | Cheap to run solo, needs no tooling, gets at motivation/hesitation, not just stated preference |
| Usability testing | **Not yet** | There's no prototype to test yet — this comes after CP4/CP7 exist, as a *later* checkpoint (see §6) |
| Surveys | **Yes, small and cheap** | Use only to sanity-check how common a concern is across more people than you can interview, not as a primary method |
| Card sorting | No | Not an information-architecture problem at this stage |
| Diary studies | No | Needs 2–8 weeks and a recruited panel you don't have — out of reach at this proficiency level |
| A/B testing | No | Needs live traffic and variants that don't exist yet |

**Realistic sample sizes for you, solo:**
- Customer interviews: **5–6**, not 8 — recruit from your own network (friends, family, coworkers at Stackup) who eat out regularly. This is a convenience sample and you should say so explicitly in the synthesis, not oversell it as representative.
- Restaurant interviews: **3–4**. This is the harder recruit — target independent restaurants in Thiruvananthapuram you could plausibly approach in person or via a warm intro (not chains — chains are explicitly Phase 2/CP13). Even 3 real conversations with restaurant owners/managers will surface more adoption risk than 20 customer interviews will.
- Survey: **15–25 responses**, distributed casually (WhatsApp/social) to people who eat out — used only to check "is the driving/hands-free scenario common," not for statistical rigor.

**Timeline**: 7–10 days total — 3–4 days recruiting and scheduling, 3–4 days running interviews, 1–2 days synthesis. Don't let this stretch past two weeks; the cost of delaying CP0–CP3 (which don't depend on any of this) starts to outweigh the value of more data past this point.

---

## 3. Research questions, precisely (what you're actually trying to learn)

### Customer side
1. When was the last time you decided you wanted to eat somewhere while you were still traveling there? What did you actually do (call ahead, just show up, order via app, nothing)?
2. How would you feel about talking out loud to plan your order and table while driving — walk me through what that would actually look/sound like for you.
3. What would make you *not* trust a system to have "already ordered for you" by the time you arrive — what's the worst version of this going wrong?
4. When you said yes to something in that scenario, what does "yes" need to feel like — a big deliberate confirmation, or lightweight?
5. (Probe, don't lead) What happens in your head if your plans change 10 minutes out — do you expect the system to know, or would you expect to have to say something?

### Restaurant side (the higher-value interviews — budget more time here)
1. Walk me through what happens right now between a phone call/walk-in and the kitchen actually starting to cook.
2. If a system told your kitchen "start this order at 7:58 for an 8:15 arrival," with no human at your end confirming it first — what's your gut reaction? What would have to be true for you to actually act on that?
3. How do you currently handle allergy/modification info from a phone booking — where does it go, who sees it, how often does it get lost or misread?
4. What's the actual cost to you if a table is held/prepped for a party that never shows?
5. Who in your restaurant would need to say yes to trying something like this — is it your call, or does it need buy-in from kitchen staff too?

Keep the interview guide structure from the skill (warm-up → context → deep dive → reaction → wrap-up), but for restaurant interviews, spend real time in "context" (question 1 above) before pitching anything — you need their actual current process before you can tell whether RAISE fits into it or fights it.

### Reaction prompt (both sides)
Rather than a working prototype (doesn't exist yet), use the vision deck itself (`RAISE_-_Before_You_Arrive.pptx`) as the concept stimulus — it's already built for exactly this. Walk through slides 1–2 (what it is) and slide 6 or 8 (the restaurant-side view) and watch for confusion or pushback, not just polite agreement.

---

## 4. Lightweight customer survey (optional, only if interviews leave a gap)

Only run this if the 5–6 interviews leave you genuinely unsure how common the "deciding while still traveling" scenario is. 4–5 questions, distributed casually:

1. In the last month, how many times did you decide where to eat *after* you'd already left the house? (0 / 1-2 / 3+)
2. When that happens, what do you usually do? (multiple choice: just show up / call ahead / use an app / nothing, decide once there)
3. If you could fully order and book your table by voice while traveling, so it's ready when you arrive — how appealing is that? (1–5 scale)
4. What would worry you most about that, if anything? (open text)
5. Optional: age range, how often they eat out (for segmenting, not gatekeeping)

Don't over-invest in this — it's a sanity check on frequency, not your primary evidence.

---

## 5. Synthesis — scaled down

Skip formal affinity-mapping software. After each interview, write a one-paragraph summary immediately (memory fades fast). After all interviews:

1. **Two columns, customer and restaurant** — list every recurring concern, hesitation, and enthusiasm you heard, with how many of your (small) sample said it. With n=5–6, "3 of 5 said X" is a real signal; a single outlier is not — say so plainly rather than dressing up one quote as a theme.
2. **Impact/effort is the wrong lens here** — you don't have design/build options to compare yet. Use a simpler **lock / adjust / kill** framing instead (see §6).
3. Write the synthesis as a short report (1–2 pages), not a deck — this is for your own decision-making, not a stakeholder presentation.

---

## 6. How findings gate the architecture — the actual point of this exercise

Map what you hear back onto specific decisions in `RAISE_production_plan.md`:

| If you hear... | Then... |
|---|---|
| Restaurants are broadly comfortable with an unconfirmed system starting to cook | **Lock** CP6 as designed — kitchen auto-starts at computed time. |
| Restaurants want a human "accept" step before the kitchen queue picks it up | **Adjust** CP6/CP8 — add a staff-side accept step between `confirmed` and `kitchen_started`; this is a real architecture change (a new status + a dashboard action), worth catching now rather than after CP6–CP8 are built. |
| Restaurants say allergy data from an app they don't control is a liability, not a convenience | **Adjust** — CP8's allergy-flag design needs a staff acknowledgment step, not just a passive display; may also affect how confidently you can market the "structured, actionable plan" claim at all. |
| Customers find hands-free voice while driving awkward/unsafe-feeling, prefer typing before leaving or at a red light | **Adjust** CP4 — de-prioritize the in-car hands-free framing in the UI/marketing, keep chat as co-equal rather than a fallback; doesn't change the backend architecture much, but changes what you build and show first. |
| Customers want lighter-weight confirmation than an explicit "yes" | **Do not adjust** — CP5's explicit-confirm gate is a trust/legal boundary (Part 5 of the production plan), not just a UX preference; hold this one even against contrary feedback, but note the tension in your synthesis. |
| Nobody among 3–4 restaurants would actually try this | **This is the kill signal.** Don't lock any architecture — go find different restaurants, or reconsider whether the wedge is right, before writing more code. |

Only CP4 (intake UX framing), CP5 (confirmation UX), CP6 (auto-start vs. accept-step), and CP8 (allergy handling) are actually load-bearing on this research. CP0–CP3 (scaffolding, data model, auth, menu CRUD) don't depend on any of it and can start in parallel with recruiting — there's no reason to block them on research completing.

---

## 7. What "locking the architecture" should mean after this

Not "no further changes ever" — it means: CP0–CP5 proceed as currently scoped, and you make one explicit, recorded decision on the CP6 auto-start-vs-accept-step question and the CP8 allergy-handling question based on what the restaurant interviews actually say, before CP6 or CP8 are built. Write that decision down (even a paragraph in this repo) so it doesn't get silently re-litigated mid-build.

## 8. What comes after this research (don't do it now)
Once CP4 and CP7 exist as real, clickable interfaces, run a proper **usability testing** pass (5–8 people, per the skill's table) against the actual voice-intake and restaurant-dashboard flows — that's a separate, later checkpoint (call it CP-UX, sequenced after CP7/CP8), not part of this pre-architecture research.
