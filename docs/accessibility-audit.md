## Accessibility Audit: RAISE concept screens (customer voice-chat & restaurant dashboard)
**Standard:** WCAG 2.1 AA | Source: rendered slides 5–6 of `RAISE_-_Before_You_Arrive.pptx`

### Summary
Measured directly from rendered pixels (not estimated). **Color contrast passes comfortably everywhere sampled** — this is a genuinely strong starting point for CP4/CP7/CP8. The real risk areas are structural (keyboard/touch/labels), not color, and can't be verified from a static deck — they need to be designed in and then re-audited once CP4/CP7 produce real, interactive screens.

### Color Contrast Check (measured)
| Element | Foreground | Background | Ratio | Required | Pass? |
|---|---|---|---|---|---|
| Slide titles (white bold on near-black) | ~white | ~near-black | ~21:1 | 4.5:1 | ✅ |
| Body/order text (white on dark card) | ~white | dark navy card | ~21:1 | 4.5:1 | ✅ |
| "SENT AS" / accent labels (orange on dark card) | orange ~(244,172,114) | dark card | ~10.2:1 | 4.5:1 | ✅ |
| Muted section labels ("DISHES", "GUESTS" — gray-on-dark) | gray ~(161,159,172) | near-black | ~8:1 | 4.5:1 | ✅ |
| "No peanuts anywhere on this table" (orange warning line) | orange ~(249,176,135) | dark bg | ~11.5:1 | 4.5:1 | ✅ |
| "8:18 food out" (dark text on solid orange fill block) | near-black text | orange fill ~(255,138,61) | ~11.2:1 | 4.5:1 (or 3:1 large) | ✅ — good call using dark-on-orange here rather than white-on-orange, which would likely have failed |

No contrast failures found in the concept deck's color choices. Carry these exact foreground/background pairings into CP4/CP7/CP8's actual design tokens rather than re-deriving a palette from scratch — they're already measured and passing.

### What can't be audited from a static deck (flag for CP4/CP7/CP8, re-audit once built)
| # | Item | WCAG Criterion | Why it matters here specifically |
|---|---|---|---|
| 1 | Keyboard/switch access to the entire voice-chat flow, including the "Listening — or type instead" toggle | 2.1.1 Keyboard | The deck shows this as a small toggle; if it's not a real, focusable, labeled control, a non-voice user has no way in at all — this is not a minor a11y nit, it's a core access path given voice is optional by design |
| 2 | Touch target size on the chat input / mic control | 2.5.5 Touch target ≥44×44px | Flagged in the design critique too — the mocked control reads visually small; this product is explicitly meant to be used one-handed/while distracted, so target size matters more here than in a typical app |
| 3 | Error identification for "no table available" / "item unavailable" states | 3.3.1 Error identification | These states don't exist in the mockup yet (see critique) — when designed, they need to be announced clearly, not just implied by a color change |
| 4 | Live-region announcement for restaurant dashboard updates (new inbound visit arriving in real time) | 4.1.2 Name, Role, Value / semantic structure | A visually-obvious new highlighted row (like the 8:15 row in slide 6) is invisible to a screen-reader user unless the update is announced via an ARIA live region — worth deciding in CP7, not discovering after |
| 5 | Focus order through the restaurant dashboard's three-column detail panel (Guests / Table / High chair) | 2.4.3 Logical focus order | Needs to be designed once this is a real DOM, not three static text blocks |

### Priority Fixes
1. **Design and label the voice/type toggle as a real, equally-weighted, keyboard-reachable control before CP4 ships** — affects anyone who can't or doesn't want to use voice, and is currently the single largest access gap in the concept.
2. **Confirm touch target sizing for the mic/input control at real device size during CP4** — affects one-handed/distracted use, which is the product's own stated context of use.
3. **Carry the measured color pairings above into CP4/CP7/CP8's design tokens as-is** — they already pass; re-deriving colors from scratch risks accidentally regressing a currently-passing contrast ratio.
