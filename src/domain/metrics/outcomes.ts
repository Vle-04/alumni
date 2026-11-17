/**
 * Outcome metrics (pure). Definitions are documented in docs/METRICS.md and mirrored in
 * ./definitions.ts for UI tooltips.
 */
import { EMPLOYED_STATUSES, EMPLOYMENT_STATUSES, type EmploymentStatus } from "../enums";
import { addMonthsUtc } from "../records/staleness";
import { DAY_MS } from "../stats/basic";

export interface ReportRecord {
  status: EmploymentStatus;
  reportedAt: Date;
  startDate: Date | null;
  companyId: string | null;
  inField: boolean | null;
  roleCategory: string | null;
  salaryBand: string | null;
}

export interface ReportGraduate {
  id: string;
  cohortId: string;
  graduationDate: Date | null;
  /** outcomes_reporting consent at report time (anonymized graduates keep their last state). */
  includeInReporting: boolean;
  records: readonly ReportRecord[];
}

export interface ReportConfig {
  /** Statuses that count as employed in the employment rate (each shown separately). */
  employedStatuses: readonly EmploymentStatus[];
  /** Statuses that count as a "first job" for time-to-first-job. */
  qualifyingJobStatuses: readonly EmploymentStatus[];
  /** A record counts for a milestone if reported from (milestone − before) to (milestone + grace). */
  windowBeforeDays: number;
  graceDays: number;
  minCell: number;
  freshnessDays: number;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  employedStatuses: [...EMPLOYED_STATUSES],
  qualifyingJobStatuses: ["employed_full_time", "employed_part_time", "freelance_contract"],
  windowBeforeDays: 90,
  graceDays: 45,
  minCell: 5,
  freshnessDays: 90,
};

const byReportedDesc = (a: ReportRecord, b: ReportRecord) => b.reportedAt.getTime() - a.reportedAt.getTime();

export function milestoneDate(g: ReportGraduate, months: number): Date | null {
  return g.graduationDate ? addMonthsUtc(g.graduationDate, months) : null;
}

/** A graduate is measurable at a milestone once milestone + grace has passed. */
export function isMature(g: ReportGraduate, months: number, now: Date, cfg = DEFAULT_REPORT_CONFIG): boolean {
  const m = milestoneDate(g, months);
  return Boolean(m && m.getTime() + cfg.graceDays * DAY_MS <= now.getTime());
}

/**
 * Status "as at" graduation + N months: the latest record reported inside the window
 * [milestone − before, milestone + grace]. A job record whose start date is after the milestone
 * does not describe the milestone, so it is skipped. No record → "unknown".
 */
export function statusAtMilestone(g: ReportGraduate, months: number, cfg = DEFAULT_REPORT_CONFIG): ReportRecord | null {
  const m = milestoneDate(g, months);
  if (!m) return null;
  const from = m.getTime() - cfg.windowBeforeDays * DAY_MS;
  const to = m.getTime() + cfg.graceDays * DAY_MS;
  const inWindow = g.records.filter((r) => r.reportedAt.getTime() >= from && r.reportedAt.getTime() <= to).sort(byReportedDesc);
  for (const r of inWindow) {
    if (cfg.employedStatuses.includes(r.status) && r.startDate && r.startDate.getTime() > m.getTime()) continue;
    if (r.status === "unknown") continue;
    return r;
  }
  return null;
}

export interface MilestoneOutcome {
  months: number;
  population: number; // mature graduates included in reporting
  byStatus: Record<EmploymentStatus, number>; // includes "unknown"
  known: number;
  unknown: number;
  employed: number;
  employedInField: number;
  employedInFieldUnknown: number;
}

export function employmentAtMilestone(grads: readonly ReportGraduate[], months: number, now: Date, cfg = DEFAULT_REPORT_CONFIG): MilestoneOutcome {
  const byStatus = Object.fromEntries(EMPLOYMENT_STATUSES.map((s) => [s, 0])) as Record<EmploymentStatus, number>;
  let employed = 0;
  let employedInField = 0;
  let employedInFieldUnknown = 0;
  let population = 0;
  for (const g of grads) {
    if (!g.includeInReporting || !isMature(g, months, now, cfg)) continue;
    population++;
    const r = statusAtMilestone(g, months, cfg);
    const status = r?.status ?? "unknown";
    byStatus[status]++;
    if (r && cfg.employedStatuses.includes(r.status)) {
      employed++;
      if (r.inField === true) employedInField++;
      else if (r.inField === null) employedInFieldUnknown++;
    }
  }
  const unknown = byStatus.unknown;
  return { months, population, byStatus, known: population - unknown, unknown, employed, employedInField, employedInFieldUnknown };
}

// ─── Time to first job (Kaplan–Meier) ─────────────────────────

export interface TimeToJob {
  graduates: number; // included, with a graduation date in the past
  withInformation: number; // have at least one record
  events: number; // found a qualifying job
  censored: number; // still without a qualifying job at their last known date
  startedBeforeGraduation: number;
  p25: number | null;
  median: number | null;
  p75: number | null; // days; null = not reached yet
  /** % of graduates employed by month N (0–12), accounting for those still searching. */
  curve: { month: number; pctEmployed: number; atRisk: number }[];
}

const MONTH_DAYS = 30.4375;

export function firstJobEvent(g: ReportGraduate, now: Date, cfg = DEFAULT_REPORT_CONFIG): { days: number; event: boolean; beforeGraduation: boolean } | null {
  if (!g.graduationDate || g.graduationDate > now || g.records.length === 0) return null;
  const grad = g.graduationDate.getTime();
  const jobs = g.records
    .filter((r) => cfg.qualifyingJobStatuses.includes(r.status))
    .map((r) => (r.startDate ?? r.reportedAt).getTime())
    .sort((a, b) => a - b);
  if (jobs.length) {
    const start = jobs[0]!;
    return { days: Math.max(0, (start - grad) / DAY_MS), event: true, beforeGraduation: start < grad };
  }
  const lastKnown = Math.min(now.getTime(), Math.max(...g.records.map((r) => r.reportedAt.getTime())));
  return { days: Math.max(0, (lastKnown - grad) / DAY_MS), event: false, beforeGraduation: false };
}

export function kaplanMeier(items: readonly { days: number; event: boolean }[]) {
  const sorted = [...items].sort((a, b) => a.days - b.days);
  const times = [...new Set(sorted.filter((x) => x.event).map((x) => x.days))];
  const steps: { days: number; cumulative: number; atRisk: number }[] = [];
  let survival = 1;
  for (const t of times) {
    const atRisk = sorted.filter((x) => x.days >= t).length;
    const d = sorted.filter((x) => x.event && x.days === t).length;
    survival *= 1 - d / atRisk;
    steps.push({ days: t, cumulative: 1 - survival, atRisk });
  }
  const at = (day: number) => {
    let f = 0;
    for (const s of steps) if (s.days <= day) f = s.cumulative;
    return f;
  };
  const quantile = (q: number) => steps.find((s) => s.cumulative >= q - 1e-12)?.days ?? null;
  const atRisk = (day: number) => sorted.filter((x) => x.days >= day).length;
  return { steps, at, quantile, atRisk };
}

export function timeToFirstJob(grads: readonly ReportGraduate[], now: Date, cfg = DEFAULT_REPORT_CONFIG): TimeToJob {
  const included = grads.filter((g) => g.includeInReporting && g.graduationDate && g.graduationDate <= now);
  const items = included.map((g) => firstJobEvent(g, now, cfg)).filter((x): x is NonNullable<typeof x> => x !== null);
  const km = kaplanMeier(items);
  const round = (x: number | null) => (x === null ? null : Math.round(x));
  return {
    graduates: included.length,
    withInformation: items.length,
    events: items.filter((i) => i.event).length,
    censored: items.filter((i) => !i.event).length,
    startedBeforeGraduation: items.filter((i) => i.beforeGraduation).length,
    p25: round(km.quantile(0.25)),
    median: round(km.quantile(0.5)),
    p75: round(km.quantile(0.75)),
    curve: Array.from({ length: 13 }, (_, month) => ({ month, pctEmployed: km.at(month * MONTH_DAYS), atRisk: km.atRisk(month * MONTH_DAYS) })),
  };
}

// ─── Current-state distributions ─────────────────────────────

export function latestRecord(g: ReportGraduate): ReportRecord | null {
  return [...g.records].sort(byReportedDesc)[0] ?? null;
}

/** Graduates per company among everyone ever employed there (each graduate counted once per company). */
export function hiresByCompany(grads: readonly ReportGraduate[], cfg = DEFAULT_REPORT_CONFIG): Map<string, number> {
  const m = new Map<string, Set<string>>();
  for (const g of grads) {
    if (!g.includeInReporting) continue;
    for (const r of g.records) {
      if (!r.companyId || !cfg.employedStatuses.includes(r.status)) continue;
      (m.get(r.companyId) ?? m.set(r.companyId, new Set()).get(r.companyId)!).add(g.id);
    }
  }
  return new Map([...m].map(([k, v]) => [k, v.size]));
}

/** Counts a field over graduates who are currently employed. */
export function currentDistribution(grads: readonly ReportGraduate[], pick: (r: ReportRecord) => string | null, cfg = DEFAULT_REPORT_CONFIG): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of grads) {
    if (!g.includeInReporting) continue;
    const r = latestRecord(g);
    if (!r || !cfg.employedStatuses.includes(r.status)) continue;
    const key = pick(r) ?? "not_stated";
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

/** Share of graduates whose latest record is newer than `freshnessDays`. */
export function freshness(grads: readonly ReportGraduate[], now: Date, cfg = DEFAULT_REPORT_CONFIG) {
  const included = grads.filter((g) => g.includeInReporting);
  const fresh = included.filter((g) => {
    const r = latestRecord(g);
    return r && now.getTime() - r.reportedAt.getTime() <= cfg.freshnessDays * DAY_MS;
  }).length;
  return { fresh, total: included.length };
}
