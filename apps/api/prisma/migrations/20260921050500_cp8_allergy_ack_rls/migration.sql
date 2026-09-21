-- CP8 — Row Level Security for visit_allergy_acknowledgments.
--
-- CP2 enumerated its tenant tables by name, so a table added later gets the
-- app-role GRANT automatically (ALTER DEFAULT PRIVILEGES, CP2 migration) but
-- NOT a policy. Without this, the database half of tenant isolation simply
-- does not cover the new table and the app-level TenantPrismaService scoping
-- would be the only thing standing between tenants.
--
-- Caught by src/prisma/rls-invariant.spec.ts, which fails for any table
-- carrying a restaurant_id column without RLS enabled. Same policy shape as
-- every other tenant table.

CREATE POLICY tenant_isolation ON "visit_allergy_acknowledgments"
  USING (restaurant_id = current_setting('app.current_restaurant_id', true))
  WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id', true));

ALTER TABLE "visit_allergy_acknowledgments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_allergy_acknowledgments" FORCE ROW LEVEL SECURITY;
