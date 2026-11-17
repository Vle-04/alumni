import { describe, expect, it } from "vitest";
import { isQuiet, nextAllowedSendTime, safeTimeZone } from "./quietHours";

describe("quiet hours", () => {
  it("detects quiet time in the recipient's zone", () => {
    // 20:30 UTC = 22:30 in Berlin (summer, UTC+2) → quiet; = 16:30 in New York → fine
    const t = new Date("2026-07-01T20:30:00Z");
    expect(isQuiet(t, "Europe/Berlin")).toBe(true);
    expect(isQuiet(t, "America/New_York")).toBe(false);
  });

  it("defers to 08:00 local", () => {
    const t = new Date("2026-07-01T20:30:00Z"); // 22:30 Berlin
    expect(nextAllowedSendTime(t, "Europe/Berlin").toISOString()).toBe("2026-07-02T06:00:00.000Z"); // 08:00 CEST
  });

  it("handles early-morning quiet time on the same day", () => {
    const t = new Date("2026-01-15T05:15:00Z"); // 06:15 Berlin (winter, UTC+1)
    expect(nextAllowedSendTime(t, "Europe/Berlin").toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("is DST-safe (night of the spring-forward change)", () => {
    const t = new Date("2026-03-28T22:00:00Z"); // 23:00 CET; clocks jump at 02:00 → 03:00
    expect(nextAllowedSendTime(t, "Europe/Berlin").toISOString()).toBe("2026-03-29T06:00:00.000Z"); // 08:00 CEST
  });

  it("returns the same time when not quiet, or when quiet hours are disabled", () => {
    const t = new Date("2026-07-01T10:00:00Z");
    expect(nextAllowedSendTime(t, "Europe/Berlin")).toEqual(t);
    expect(nextAllowedSendTime(new Date("2026-07-01T22:00:00Z"), "UTC", { startHour: 0, endHour: 0 })).toEqual(new Date("2026-07-01T22:00:00Z"));
  });

  it("falls back for unknown zones", () => {
    expect(safeTimeZone("Mars/Base", "UTC")).toBe("UTC");
    expect(safeTimeZone(null, "Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(safeTimeZone("Asia/Tokyo", "UTC")).toBe("Asia/Tokyo");
  });
});
