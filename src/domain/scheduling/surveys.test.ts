import { describe, expect, it } from "vitest";
import { milestoneDueDate, nextReminderDue, planSurveys, shouldSkipForRecentUpdate, type ExistingInstance } from "./surveys";

const grad = new Date("2026-01-31T00:00:00Z");
const now = new Date("2026-01-31T12:00:00Z");

describe("milestoneDueDate", () => {
  it("adds calendar months, clamped to month end, at the send hour", () => {
    expect(milestoneDueDate(grad, 1).toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(milestoneDueDate(grad, 12).toISOString()).toBe("2027-01-31T09:00:00.000Z");
  });
});

describe("planSurveys", () => {
  it("creates exactly four instances for a new graduate", () => {
    const plan = planSurveys(grad, [], now);
    expect(plan.filter((a) => a.type === "create").map((a) => a.milestone)).toEqual([1, 3, 6, 12]);
  });

  it("marks milestones already well in the past as missed", () => {
    const plan = planSurveys(new Date("2025-02-10T00:00:00Z"), [], now); // 12-month due 2026-02-10 (future)
    expect(plan.map((a) => (a.type === "create" ? a.status : null))).toEqual(["missed", "missed", "missed", "scheduled"]);
  });

  it("marks every milestone missed for long-ago graduates", () => {
    expect(planSurveys(new Date("2024-01-01T00:00:00Z"), [], now).every((a) => a.type === "create" && a.status === "missed")).toBe(true);
  });

  it("keeps a recently passed milestone sendable (within the grace period)", () => {
    const plan = planSurveys(new Date("2025-12-25T00:00:00Z"), [], new Date("2026-02-01T00:00:00Z"));
    expect(plan[0]).toMatchObject({ milestone: 1, status: "scheduled" });
  });

  it("is idempotent: re-planning with the same date changes nothing", () => {
    const existing: ExistingInstance[] = planSurveys(grad, [], now).map((a, i) => ({ id: `s${i}`, milestone: a.milestone, status: a.type === "create" ? a.status : "scheduled", scheduledFor: a.type === "create" ? a.scheduledFor : now }));
    expect(planSurveys(grad, existing, now).every((a) => a.type === "keep")).toBe(true);
  });

  it("moves unsent instances when the date changes and leaves sent ones alone", () => {
    const existing: ExistingInstance[] = [
      { id: "a", milestone: 1, status: "completed", scheduledFor: new Date("2026-02-28T09:00:00Z") },
      { id: "b", milestone: 3, status: "scheduled", scheduledFor: new Date("2026-04-30T09:00:00Z") },
      { id: "c", milestone: 6, status: "scheduled", scheduledFor: new Date("2026-07-31T09:00:00Z") },
      { id: "d", milestone: 12, status: "sent", scheduledFor: new Date("2027-01-31T09:00:00Z") },
    ];
    const plan = planSurveys(new Date("2026-03-15T00:00:00Z"), existing, now);
    expect(plan).toEqual([
      { type: "keep", id: "a", milestone: 1 },
      { type: "update", id: "b", milestone: 3, scheduledFor: new Date("2026-06-15T09:00:00Z"), status: "scheduled" },
      { type: "update", id: "c", milestone: 6, scheduledFor: new Date("2026-09-15T09:00:00Z"), status: "scheduled" },
      { type: "keep", id: "d", milestone: 12 },
    ]);
    expect(plan.filter((a) => a.type === "create")).toHaveLength(0); // never duplicates
  });

  it("cancels unsent instances when the date is removed, and revives them when set again", () => {
    const existing: ExistingInstance[] = [{ id: "a", milestone: 1, status: "scheduled", scheduledFor: new Date("2026-02-28T09:00:00Z") }];
    const cancelled = planSurveys(null, existing, now);
    expect(cancelled[0]).toMatchObject({ type: "update", status: "cancelled" });
    const revived = planSurveys(grad, [{ ...existing[0]!, status: "cancelled" }], now);
    expect(revived[0]).toMatchObject({ type: "update", status: "scheduled" });
  });
});

describe("reminders", () => {
  const sent = new Date("2026-03-01T09:00:00Z");
  it("sends at +4 and +10 days after the first send, then stops", () => {
    expect(nextReminderDue(sent, 0)?.toISOString()).toBe("2026-03-05T09:00:00.000Z");
    expect(nextReminderDue(sent, 1)?.toISOString()).toBe("2026-03-11T09:00:00.000Z");
    expect(nextReminderDue(sent, 2)).toBeNull();
  });
  it("never reminds about an unsent survey", () => expect(nextReminderDue(null, 0)).toBeNull());
});

describe("shouldSkipForRecentUpdate", () => {
  it("skips when the self-update is within the window", () => {
    expect(shouldSkipForRecentUpdate(new Date("2026-01-20T00:00:00Z"), now)).toBe(true);
    expect(shouldSkipForRecentUpdate(new Date("2026-01-10T00:00:00Z"), now)).toBe(false);
    expect(shouldSkipForRecentUpdate(null, now)).toBe(false);
    expect(shouldSkipForRecentUpdate(new Date("2026-01-20T00:00:00Z"), now, 7)).toBe(false); // configurable
  });
});
