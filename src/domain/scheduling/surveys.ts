/**
 * Survey scheduling rules (pure). The service layer turns the plan into database writes.
 *
 *  - Exactly one SurveyInstance per (graduate, milestone) — milestones 1, 3, 6, 12 months.
 *  - Changing the graduation date moves every *unsent* instance; sent/answered ones are history.
 *  - Milestones already more than `missedGraceDays` in the past when (re)scheduled are marked
 *    "missed" and never sent (no "1-month" survey two years after graduation).
 *  - Removing the graduation date cancels unsent instances; setting it again revives them.
 *  - CATCH-UP: if any milestone is "missed", the most recent missed one becomes a single catch-up
 *    survey due now ("where are you now?"). At most one catch-up per graduate, ever; once created
 *    it is never moved or re-created by later re-planning.
 */
import { MILESTONES, type Milestone } from "../enums";
import { addDays, addMonthsUtc } from "../records/staleness";

export type SurveyStatus = "scheduled" | "queued" | "sent" | "completed" | "skipped_recent_update" | "missed" | "bounced" | "cancelled";

/** Instances in these states have not been sent and may be moved or cancelled. */
export const RESCHEDULABLE: readonly SurveyStatus[] = ["scheduled", "missed", "cancelled"];

export interface SchedulingConfig {
  missedGraceDays: number;
  /** UTC hour at which a milestone becomes due (quiet hours are applied at send time). */
  sendHourUtc: number;
}
export const DEFAULT_SCHEDULING: SchedulingConfig = { missedGraceDays: 14, sendHourUtc: 9 };

export interface ExistingInstance {
  id: string;
  milestone: number;
  status: SurveyStatus;
  scheduledFor: Date;
  catchUp?: boolean;
}

export type PlanAction =
  | { type: "create"; milestone: Milestone; scheduledFor: Date; status: "scheduled" | "missed"; catchUp?: true }
  | { type: "update"; id: string; milestone: number; scheduledFor: Date; status: "scheduled" | "missed" | "cancelled"; catchUp?: true }
  | { type: "keep"; id: string; milestone: number };

export function milestoneDueDate(graduationDate: Date, milestone: Milestone, cfg: SchedulingConfig = DEFAULT_SCHEDULING): Date {
  const d = addMonthsUtc(graduationDate, milestone);
  d.setUTCHours(cfg.sendHourUtc, 0, 0, 0);
  return d;
}

export function planSurveys(
  graduationDate: Date | null,
  existing: readonly ExistingInstance[],
  now: Date,
  cfg: SchedulingConfig = DEFAULT_SCHEDULING,
): PlanAction[] {
  const byMilestone = new Map(existing.map((e) => [e.milestone, e]));
  const actions: PlanAction[] = [];
  for (const m of MILESTONES) {
    const ex = byMilestone.get(m);
    if (!graduationDate) {
      if (ex && RESCHEDULABLE.includes(ex.status) && ex.status !== "cancelled") {
        actions.push({ type: "update", id: ex.id, milestone: m, scheduledFor: ex.scheduledFor, status: "cancelled" });
      } else if (ex) actions.push({ type: "keep", id: ex.id, milestone: m });
      continue;
    }
    if (ex?.catchUp) {
      actions.push({ type: "keep", id: ex.id, milestone: m }); // a catch-up is never moved
      continue;
    }
    const due = milestoneDueDate(graduationDate, m, cfg);
    const status = due < addDays(now, -cfg.missedGraceDays) ? "missed" : "scheduled";
    if (!ex) actions.push({ type: "create", milestone: m, scheduledFor: due, status });
    else if (RESCHEDULABLE.includes(ex.status) && (ex.scheduledFor.getTime() !== due.getTime() || ex.status !== status)) {
      actions.push({ type: "update", id: ex.id, milestone: m, scheduledFor: due, status });
    } else actions.push({ type: "keep", id: ex.id, milestone: m });
  }
  return graduationDate ? addCatchUp(actions, existing, now) : actions;
}

/** Turns the most recent missed milestone into the graduate's one catch-up survey, due now. */
function addCatchUp(actions: PlanAction[], existing: readonly ExistingInstance[], now: Date): PlanAction[] {
  if (existing.some((e) => e.catchUp)) return actions;
  const byId = new Map(existing.map((e) => [e.id, e]));
  const missed = actions.filter((a) =>
    a.type === "keep" ? byId.get(a.id)?.status === "missed" : a.status === "missed",
  );
  const latest = missed.sort((a, b) => b.milestone - a.milestone)[0];
  if (!latest) return actions;
  return actions.map((a) => {
    if (a !== latest) return a;
    if (a.type === "create") return { ...a, status: "scheduled" as const, scheduledFor: now, catchUp: true as const };
    return { type: "update" as const, id: a.id, milestone: a.milestone, scheduledFor: now, status: "scheduled" as const, catchUp: true as const };
  });
}

// ─── Reminders ───────────────────────────────────────────────

export interface ReminderConfig {
  /** Days after the FIRST send at which reminders go out. Brief: 4 and 10, then stop. */
  offsetsDays: readonly number[];
}
export const DEFAULT_REMINDERS: ReminderConfig = { offsetsDays: [4, 10] };

/** When the next reminder is due, or null if no more reminders should be sent. */
export function nextReminderDue(sentAt: Date | null, reminderCount: number, cfg: ReminderConfig = DEFAULT_REMINDERS): Date | null {
  if (!sentAt) return null;
  const offset = cfg.offsetsDays[reminderCount];
  return offset === undefined ? null : addDays(sentAt, offset);
}

/** Skip a milestone survey if the graduate self-updated within the window before it is due. */
export function shouldSkipForRecentUpdate(lastSelfUpdateAt: Date | null, now: Date, windowDays = 14): boolean {
  return Boolean(lastSelfUpdateAt && lastSelfUpdateAt > addDays(now, -windowDays) && lastSelfUpdateAt <= now);
}
