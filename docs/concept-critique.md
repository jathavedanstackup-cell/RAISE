## Design Critique: RAISE — embedded UI mockups (customer chat screen & restaurant "Tonight — Inbound" dashboard)

Context: these are the two screens in the vision deck that function as actual UI mockups rather than explanatory diagrams — the "Spice Route / planning tonight's visit" voice-chat interface (customer side) and the "Tonight — Incoming" ops panel (restaurant side). Stage: early exploration, pre-build. Reviewed as the literal starting point for CP4 (intake UI) and CP7 (FOH dashboard).

### Overall Impression
Both screens communicate the product idea clearly and the editorial typography carries real credibility for a pitch — but neither has been stress-tested against a live, uncertain conversation or a busy dinner service. The customer screen shows a clean, already-resolved chat; the restaurant screen shows a tidy three-row queue. Both are best-case snapshots, and the real risk in CP4/CP7 is what these screens don't show yet.

### Usability

| Finding | Severity | Recommendation |
|---|---|---|
| Customer chat screen shows only the happy path — no visible affordance for "the system misheard me" or "let me change an item" | 🔴 Critical | Before CP4 is built, design an explicit correction/edit state (e.g. a message bubble the customer can tap to edit, or a clear "say it again" prompt) — the deck itself promises "you can interrupt, change your mind" (slide 5) but the mockup never shows what that looks like |
| No visible state for "no table available" or "item unavailable" on either screen | 🔴 Critical | These are named failure paths in the production plan (Part 4.3) — design them now, not as an afterthought once CP4/CP5 are mid-build; an honest decline is core to the product's trust claim ("nothing is booked until you say yes") |
| Restaurant dashboard shows exactly 3 tidy rows; real dinner service is 15-30+ concurrent visits at varying stages | 🟡 Moderate | Before CP7, mock the same screen with realistic volume and mixed statuses (order-in, kitchen-started, table-set, arrived-late) to check the layout still scans in under 2 seconds — a FOH host doesn't have time to parse a dense list |
| "Listening — or type" toggle is a single small dot + label at the bottom of the customer screen | 🟡 Moderate | Given typing is a co-equal fallback (not a lesser option — see the research plan's finding that hands-free comfort is unproven), give text input equal visual weight, not a subordinate toggle |
| Confirmation step ("Booked — 8:15, table 11") is a single chat bubble, same visual weight as every other message | 🟡 Moderate | This is the single most consequential moment in the whole flow (the trust boundary from Part 5 of the production plan) — it should look and feel distinct from ordinary conversation turns, not just another bubble in the thread |

### Visual Hierarchy
- **What draws the eye first — customer screen**: the dark "Booked" confirmation pill at the bottom, which is correct — that's the payoff moment.
- **What draws the eye first — restaurant screen**: the black "TONIGHT — INCOMING" header, then the highlighted first row (8:15, orange accent). Also correct — matches the "what needs my attention right now" priority a host actually has.
- **Reading flow**: both screens read top-to-bottom cleanly in isolation. Untested: whether the restaurant screen's reading order still holds once real-time updates start arriving mid-shift (a new row pushing others down while staff are mid-task) — this is a motion/notification design question CP7 needs, not just a static layout question.
- **Emphasis**: allergy flag ("No peanuts anywhere on this table") is in the accent orange on the restaurant detail view — correctly the most emphasized line on that panel, consistent with the research plan's finding that allergy handling is a trust-critical, not cosmetic, detail.

### Consistency
| Element | Issue | Recommendation |
|---|---|---|
| Timestamp format | Consistent (`7:52`, `8:15`) across both screens and the supporting diagrams | No change — keep this as a locked convention going into CP1's `Visit` timestamp fields, so the UI never has to reformat what the API stores |
| Accent color (orange) usage | Used for both "urgent/next" (restaurant queue highlight) and "flag/warning" (allergy line) | Worth deciding now, not during CP7/CP8 build: one accent color is being asked to mean two different things (priority vs. warning). Consider a second, distinct treatment for allergy/safety flags specifically, so a busy kitchen display never has to guess which kind of orange it's looking at |
| Terminology | "guests," "party," and "table" used somewhat interchangeably across screens | Pin exact field names now (matches `Visit.party_size` etc. in the production plan's data model) so copy and schema stay in lockstep from CP1 onward |

### Accessibility
- **Color contrast**: the dark-background screens (orange-on-near-black, white-on-near-black) read as high contrast in the rendered deck; the light screens (dark ink on the warm off-white) are also solid. Verify formally with `design:accessibility-review` once CP4/CP7 produce real, styleable screens — the deck's static renders are a reasonable signal but not a substitute for a measured pass.
- **Touch targets**: the mocked chat input / "Listening" control is small relative to typical touch-target guidance (44×44pt) — flag for CP4's actual implementation, especially since this is meant to be used one-handed/hands-free.
- **Text readability**: body sizes in the mockups are generous and legible; the small monospace labels (timestamps, section numbers) are the smallest text on either screen — fine for a pitch deck, worth double-checking at real device size for the kitchen display specifically (CP8), where legibility under time pressure and glare matters more than in a boardroom.

### What Works Well
- The core interaction metaphor — a normal-looking chat thread that quietly produces a structured, bookable visit — is genuinely well judged; it doesn't over-explain itself to the user, which matches the product's own "voice is only the way in" philosophy.
- The restaurant panel's "PREPARATION" timeline strip (7:58 start → 8:10 table set → 8:15 arrive → 8:18 food out) is an excellent piece of UI — it's the single clearest visualization of the entire product's value proposition, and it's worth preserving close to verbatim into CP8's kitchen display design.

### Priority Recommendations
1. **Design the unhappy paths before CP4 starts** — correction/edit state, "no table available," "item unavailable." These are named in the production plan but not yet drawn; drawing them now is far cheaper than discovering the gap mid-checkpoint.
2. **Mock the restaurant dashboard at realistic volume and mixed status, not 3 tidy rows** — this is the difference between a screen that looks good in a pitch and one that actually works during a Friday dinner rush; feed this into CP7's actual spec.
3. **Resolve the double-duty accent color (priority vs. warning) before CP8** — a kitchen display cannot afford ambiguity between "this is next" and "this is an allergy."
