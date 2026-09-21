/**
 * Shared types package — CP0 scaffolding only.
 *
 * This is a placeholder to prove the monorepo wiring (build, typecheck, and
 * consumption from apps/api, apps/customer, apps/restaurant) works end to
 * end. The real domain model (Restaurant, MenuItem, Table, Visit, ...) lands
 * in CP1 — see docs/checkpoints/CP01-data-model.md.
 */

export type ServiceName = "api" | "customer" | "restaurant";

export interface ServiceHealth {
  service: ServiceName;
  status: "ok";
}

export * from "./menu-item.js";
export * from "./staff-auth.js";
export * from "./intake.js";
export * from "./confirmation.js";
export * from "./dashboard.js";
export * from "./kitchen.js";
