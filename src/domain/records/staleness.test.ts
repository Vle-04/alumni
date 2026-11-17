import { describe, expect, it } from "vitest";
import { addMonthsUtc, daysBetween, isStale } from "./staleness";

describe("staleness", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("treats missing updates as stale", () => expect(isStale(null, now)).toBe(true));
  it("uses a strict > 90 day boundary", () => {
    expect(isStale(new Date("2026-03-03T00:00:00Z"), now)).toBe(false); // exactly 90 days
    expect(isStale(new Date("2026-03-02T00:00:00Z"), now)).toBe(true); // 91 days
  });
  it("counts whole days", () => expect(daysBetween(new Date("2026-01-01"), new Date("2026-01-31"))).toBe(30));
});

describe("addMonthsUtc", () => {
  it("clamps to month end", () => {
    expect(addMonthsUtc(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonthsUtc(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
  it("crosses years", () => expect(addMonthsUtc(new Date("2026-11-15T00:00:00Z"), 3).toISOString()).toBe("2027-02-15T00:00:00.000Z"));
});
