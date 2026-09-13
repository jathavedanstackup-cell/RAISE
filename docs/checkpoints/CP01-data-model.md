# CP1 — Core data model & migrations

Source: `docs/production-plan.md`, Part 6 (see also Part 3 for the full schema).

**Deliverables**: Postgres schema/migrations for `Restaurant`, `MenuItem`, `Table`, `Visit`, `VisitItem`, `ConversationTurn`, `NotificationLog` per `docs/production-plan.md` Part 3; seed script with one demo restaurant + menu + tables (use the deck's own "Spice Route" example data as seed fixtures).

**Done when**: migrations run clean from empty DB; seed script produces a queryable demo restaurant; basic CRUD covered by tests for each table.

**Depends on**: CP0 merged (monorepo + Docker Postgres running).
