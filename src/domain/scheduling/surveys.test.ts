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

  it("marks milestones already well in the past as missed, with ONE catch-up for the latest missed", () => {
    const plan = planSurveys(new Date("2025-02-10T00:00:00Z"), [], now); // 12-month due 2026-02-10 (future)
    expect(plan.map((a) => (a.type === "create" ? `${a.status}${a.catchUp ? "+catchup" : ""}` : null))).toEqual(["missed", "missed", "scheduled+catchup", "scheduled"]);
    expect(plan.find((a) => a.type === "create" && a.catchUp)).toMatchObject({ milestone: 6, scheduledFor: now });
  });

  it("long-ago graduates: three missed milestones and one catch-up (the 12-month) due now", () => {
    const plan = planSurveys(new Date("2024-01-01T00:00:00Z"), [], now);
    expect(plan.map((a) => (a.type === "create" ? `${a.milestone}:${a.status}${a.catchUp ? "+catchup" : ""}` : ""))).toEqual(["1:missed", "3:missed", "6:missed", "12:scheduled+catchup"]);
  });

  it("never creates a second catch-up and never moves an existing one", () => {
    const existing: ExistingInstance[] = [
      { id: "a", milestone: 1, status: "missed", scheduledFor: new Date("2024-02-01T09:00:00Z") },
      { id: "b", milestone: 3, status: "missed", scheduledFor: new Date("2024-04-01T09:00:00Z") },
      { id: "c", milestone: 6, status: "missed", scheduledFor: new Date("2024-07-01T09:00:00Z") },
      { id: "d", milestone: 12, status: "completed", scheduledFor: now, catchUp: true },
    ];
    const plan = planSurveys(new Date("2023-06-01T00:00:00Z"), existing, now); // date changed later
    expect(plan.filter((a) => a.type !== "keep" && "catchUp" in a && a.catchUp)).toEqual([]);
    expect(plan.find((a) => a.milestone === 12)).toEqual({ type: "keep", id: "d", milestone: 12 });
  });

  it("re-planning with an existing missed row converts it (no duplicate rows)", () => {
    const existing: ExistingInstance[] = planSurveys(new Date("2024-01-01T00:00:00Z"), [], now).map((a, i) => ({ id: `s${i}`, milestone: a.milestone, status: "missed", scheduledFor: now }));
    const plan = planSurveys(new Date("2024-01-01T00:00:00Z"), existing, now);
    expect(plan.filter((a) => a.type === "create")).toEqual([]);
    expect(plan.filter((a) => a.type === "update" && a.catchUp).map((a) => a.milestone)).toEqual([12]);
  });

  it("keeps a recently passed milestone sendable (within the grace period)", () => {
    const plan = planSurveys(new Date("2025-12-25T00:00:00Z"), [], new Date("2026-02-01T00:00:00Z"));
    expect(plan[0]).toMatchObject({ milestone: 1, status: "scheduled" });
  });

  it("is idempotent: re-planning with the same date changes nothing", () => {
    // (no missed milestones here, so no catch-up is involved)
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
