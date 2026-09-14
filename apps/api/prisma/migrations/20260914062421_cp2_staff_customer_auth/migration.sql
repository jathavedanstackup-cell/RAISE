-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('owner', 'foh', 'kitchen');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMP(3),
    "name" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "staff_memberships_restaurant_id_idx" ON "staff_memberships"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_memberships_user_id_restaurant_id_key" ON "staff_memberships"("user_id", "restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "visits_customer_id_idx" ON "visits"("customer_id");

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- CP2 tenant-isolation enforcement layer (Part 5: "enforced at the
-- ORM/query layer", Part 8/CLAUDE.md Rule #4). See docs/decisions.md.
--
-- This migration runs as the migration/owner role (DATABASE_URL, "raise"
-- locally) which is a Postgres SUPERUSER in this project's docker-compose
-- and CI setup. Superusers and table owners with BYPASSRLS always bypass
-- Row Level Security, full stop, regardless of FORCE ROW LEVEL SECURITY —
-- so RLS policies alone would be dead code if the app connected as this
-- role. A second, unprivileged role is created here for the app's runtime
-- connection (APP_DATABASE_URL). Migrations/seed keep using DATABASE_URL.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'raise_app') THEN
    CREATE ROLE raise_app WITH LOGIN PASSWORD 'raise_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE raise TO raise_app;
GRANT USAGE ON SCHEMA public TO raise_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "restaurants",
  "menu_items",
  "tables",
  "visits",
  "visit_status_events",
  "visit_items",
  "conversation_turns",
  "notification_logs",
  "users",
  "staff_memberships",
  "customers"
TO raise_app;

-- Any table a *future* migration adds (still run as the owner role) is
-- automatically readable/writable by raise_app without a repeat GRANT.
-- RLS itself is NOT inherited this way — enabling/forcing RLS and adding
-- policies on a new tenant-scoped table is still a manual step for that
-- migration to take, same as adding its restaurant_id index today.
ALTER DEFAULT PRIVILEGES FOR ROLE raise IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO raise_app;

-- Tenant-scoped tables: RLS + FORCE (so even the owning "raise" role would
-- be subject to it, were it ever used for app traffic) + two permissive
-- policies per table. Postgres OR's permissive policies together, so a row
-- is visible/writable if EITHER matches:
--   1. tenant_isolation — restaurant_id equals the session's scoped tenant.
--   2. tenant_bypass    — an explicit, narrow escape hatch for operations
--      that are legitimately cross-tenant by nature (seeding, a future
--      platform-admin path). Never set by normal request handling.
-- current_setting(..., true) returns NULL when unset, and
-- "restaurant_id = NULL" is never TRUE — so the default with neither
-- session var set is zero rows. Fails closed, not open.
CREATE POLICY tenant_isolation ON "restaurants"
  USING (id = current_setting('app.current_restaurant_id', true))
  WITH CHECK (id = current_setting('app.current_restaurant_id', true));
CREATE POLICY tenant_bypass ON "restaurants"
  USING (current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "restaurants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restaurants" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'menu_items', 'tables', 'visits', 'visit_status_events',
    'visit_items', 'conversation_turns', 'notification_logs', 'staff_memberships'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (restaurant_id = current_setting(''app.current_restaurant_id'', true)) WITH CHECK (restaurant_id = current_setting(''app.current_restaurant_id'', true))',
      t
    );
    EXECUTE format(
      'CREATE POLICY tenant_bypass ON %I USING (current_setting(''app.bypass_rls'', true) = ''on'') WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'')',
      t
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- "users" and "customers" are deliberately NOT RLS-scoped: they are global
-- identity tables (a staff user can belong to more than one restaurant via
-- staff_memberships; a customer is not owned by any single restaurant).
