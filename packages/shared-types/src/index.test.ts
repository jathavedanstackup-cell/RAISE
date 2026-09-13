import { describe, expect, it } from "vitest";
import type { ServiceHealth } from "./index.js";

describe("shared-types", () => {
  it("produces a well-typed ServiceHealth value", () => {
    const health: ServiceHealth = { service: "api", status: "ok" };
    expect(health.status).toBe("ok");
  });
});
