/**
 * A single source of truth for the draft inactivity window (Part 8 Q3 —
 * see docs/decisions.md), shared by IntakeService (Visit.draftExpiresAt)
 * and IntakeTokenService (the draft capability token's own `exp` claim).
 * They deliberately share this constant, not two independently-chosen
 * numbers that could drift apart.
 */
export const DRAFT_INACTIVITY_WINDOW_MS = 15 * 60 * 1000;
export const DRAFT_INACTIVITY_WINDOW_SECONDS = DRAFT_INACTIVITY_WINDOW_MS / 1000;
