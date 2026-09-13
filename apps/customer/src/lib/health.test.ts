import { describe, expect, it } from "vitest";
import { getServiceHealth } from "./health";

describe("getServiceHealth", () => {
  it("reports ok status for the customer service", () => {
    expect(getServiceHealth("customer")).toEqual({ service: "customer", status: "ok" });
  });
});
