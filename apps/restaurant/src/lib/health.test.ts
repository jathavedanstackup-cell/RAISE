import { describe, expect, it } from "vitest";
import { getServiceHealth } from "./health";

describe("getServiceHealth", () => {
  it("reports ok status for the restaurant service", () => {
    expect(getServiceHealth("restaurant")).toEqual({ service: "restaurant", status: "ok" });
  });
});
