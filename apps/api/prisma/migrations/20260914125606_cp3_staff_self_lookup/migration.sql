-- ============================================================================
-- CP3: a staff member needs to discover which restaurant(s) they belong to
-- right after login (GET /auth/staff/me) — the JWT deliberately carries no
-- restaurant_id (see docs/decisions.md, CP2 "auth primitives"), so this is
-- resolved by looking up the caller's own staff_memberships rows. That
-- table's only RLS policy (from CP2) scopes by restaurant_id, which the
-- caller doesn't know yet at this point — a real chicken-and-egg gap, not
-- something to route around with the deleted app.bypass_rls escape hatch.
--
-- This adds a SECOND, narrow permissive policy: a row is also visible if
-- its user_id matches the caller's own verified identity
-- (app.current_user_id, set only from a JWT's own `sub` claim after
-- verification — never client-supplied). Postgres ORs permissive policies,
-- so the existing tenant_isolation policy is unchanged and unweakened by
-- this addition: it only ever grants a user visibility into THEIR OWN
-- membership rows, never anyone else's, and never touches any other table.
-- ============================================================================

CREATE POLICY self_membership_lookup ON "staff_memberships"
  USING ("user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true));
