/**
 * Assembles the outcomes report from raw facts and applies every privacy rule. The result
 * contains only aggregates that are safe to show to Leadership/Marketing:
 *  - cohorts with fewer than k reportable graduates are excluded from EVERY figure (so date-range
 *    filters cannot be differenced to reveal them), with only the excluded count shown;
 *  - counts of 1..k-1 are shown as "<k", with secondary suppression inside each group;
 *  - rates are hidden when they would reveal a small group;
 *  - employers appear by name only with at least k hires; the rest fold into "Other employers".
 */
import { EMPLOYMENT_STATUSES, type EmploymentStatus } from "../enums";
import { MIN_CELL, cell, safeRate, suppressGroup, type SafeCell, type SafeRate } from "./suppression";
import {
  DEFAULT_REPORT_CONFIG, currentDistribution, employmentAtMilestone, freshness, hiresByCompany, timeToFirstJob,
  type ReportConfig, type ReportGraduate,
} from "./outcomes";

export interface CohortInfo {
  id: string;
  name: string;
  programId: string;
  programName: string;
  graduationDate: Date | null;
}
export interface CompanyInfo {
  id: string;
  name: string;
  isPartner: boolean;
}

export interface MilestoneBlock {
  months: number;
  population: SafeCell;
  responseRate: SafeRate;
  unknown: SafeCell;
  employmentRate: SafeRate;
  employmentRateInField: SafeRate;
  /** Employed ÷ everyone (treating unknown as not employed) — a lower bound, always shown with the main rate. */
  employmentRateLowerBound: SafeRate;
  breakdown: SafeCell<EmploymentStatus>[];
  inFieldUnknown: SafeCell;
}

function milestoneBlock(grads: readonly ReportGraduate[], months: number, now: Date, cfg: ReportConfig): MilestoneBlock {
  const m = employmentAtMilestone(grads, months, now, cfg);
  const k = cfg.minCell;
  const known = m.known; // graduates with a known status
  return {
    months,
    population: cell("population", m.population, k),
    responseRate: safeRate(m.known, m.population, k),
    unknown: cell("unknown", m.unknown, k),
    employmentRate: safeRate(m.employed, known, k),
    employmentRateInField: safeRate(m.employedInField, known, k),
    employmentRateLowerBound: safeRate(m.employed, m.population, k),
    breakdown: suppressGroup(EMPLOYMENT_STATUSES.map((s) => ({ key: s, n: m.byStatus[s] })), k),
    inFieldUnknown: cell("inFieldUnknown", m.employedInFieldUnknown, k),
  };
}

export interface OutcomesReport {
  generatedAt: string;
  config: { employedStatuses: readonly string[]; qualifyingJobStatuses: readonly string[]; minCell: number; windowBeforeDays: number; graceDays: number };
  tooSmall: boolean;
  population: { graduates: SafeCell; excludedNoConsent: SafeCell; excludedSmallCohorts: SafeCell; cohortsIncluded: number };
  freshness: SafeRate;
  milestones: MilestoneBlock[];
  timeToJob: {
    graduates: SafeCell; events: SafeCell; stillSearchingOrUnknown: SafeCell; startedBeforeGraduation: SafeCell;
    p25: number | null; median: number | null; p75: number | null; suppressed: boolean;
    curve: { month: number; pctEmployed: number }[];
  };
  curvesByCohort: { cohortId: string; name: string; graduates: number; curve: { month: number; pctEmployed: number | null }[] }[];
  topEmployers: { name: string; isPartner: boolean; hires: number }[];
  otherEmployers: { hires: SafeCell; companies: number };
  partnerSplit: SafeCell<"partner" | "non_partner">[];
  roles: SafeCell[];
  salaryBands: SafeCell[];
  cohorts: {
    id: string; name: string; programName: string; graduationDate: string | null; graduates: SafeCell;
    responseRate6: SafeRate; rate6: SafeRate; rate12: SafeRate; medianDays: number | null;
  }[];
}

const SALARY_ORDER = ["band_0_500", "band_500_1000", "band_1000_1500", "band_1500_2500", "band_2500_4000", "band_4000_plus", "prefer_not_to_say", "not_stated"];

export function buildOutcomesReport(
  allGrads: readonly ReportGraduate[],
  cohorts: readonly CohortInfo[],
  companies: readonly CompanyInfo[],
  now: Date,
  rawCfg: ReportConfig = DEFAULT_REPORT_CONFIG,
): OutcomesReport {
  // Defence in depth: the settings schema already refuses < 5, but a bad value in the database
  // (or a caller passing a config) can never lower the privacy threshold below MIN_CELL.
  const cfg = { ...rawCfg, minCell: Math.max(MIN_CELL, rawCfg.minCell) };
  const k = cfg.minCell;
  const consenting = allGrads.filter((g) => g.includeInReporting);
  const perCohort = new Map<string, number>();
  for (const g of consenting) perCohort.set(g.cohortId, (perCohort.get(g.cohortId) ?? 0) + 1);
  const bigCohorts = new Set([...perCohort].filter(([, n]) => n >= k).map(([id]) => id));
  const grads = consenting.filter((g) => bigCohorts.has(g.cohortId));
  const excludedSmall = consenting.length - grads.length;

  const ttj = timeToFirstJob(grads, now, cfg);
  const ttjSuppressed = ttj.withInformation < k || ttj.events < k;
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const hires = [...hiresByCompany(grads, cfg)].map(([id, n]) => ({ ...companyById.get(id)!, hires: n })).filter((c) => c.name);
  const named = hires.filter((h) => h.hires >= k).sort((a, b) => b.hires - a.hires || a.name.localeCompare(b.name)).slice(0, 10);
  const namedIds = new Set(named.map((n) => n.id));
  const other = hires.filter((h) => !namedIds.has(h.id));

  const roles = [...currentDistribution(grads, (r) => r.roleCategory, cfg)].sort((a, b) => b[1] - a[1]);
  const bands = currentDistribution(grads, (r) => r.salaryBand, cfg);

  const cohortRows = cohorts
    .filter((c) => bigCohorts.has(c.id))
    .sort((a, b) => (a.graduationDate?.getTime() ?? 0) - (b.graduationDate?.getTime() ?? 0))
    .map((c) => {
      const cg = grads.filter((g) => g.cohortId === c.id);
      const m6 = employmentAtMilestone(cg, 6, now, cfg);
      const m12 = employmentAtMilestone(cg, 12, now, cfg);
      const t = timeToFirstJob(cg, now, cfg);
      return {
        id: c.id, name: c.name, programName: c.programName, graduationDate: c.graduationDate?.toISOString().slice(0, 10) ?? null,
        graduates: cell("n", cg.length, k),
        responseRate6: safeRate(m6.known, m6.population, k),
        rate6: safeRate(m6.employed, m6.known, k),
        rate12: safeRate(m12.employed, m12.known, k),
        medianDays: t.events >= k ? t.median : null,
        curve: t,
        n: cg.length,
      };
    });

  const fr = freshness(grads, now, cfg);
  return {
    generatedAt: now.toISOString(),
    config: { employedStatuses: cfg.employedStatuses, qualifyingJobStatuses: cfg.qualifyingJobStatuses, minCell: k, windowBeforeDays: cfg.windowBeforeDays, graceDays: cfg.graceDays },
    tooSmall: grads.length < k,
    population: {
      graduates: cell("graduates", grads.length, k),
      excludedNoConsent: cell("noConsent", allGrads.length - consenting.length, k),
      excludedSmallCohorts: cell("smallCohorts", excludedSmall, k),
      cohortsIncluded: bigCohorts.size,
    },
    freshness: safeRate(fr.fresh, fr.total, k),
    milestones: [6, 12].map((m) => milestoneBlock(grads, m, now, cfg)),
    timeToJob: {
      graduates: cell("g", ttj.withInformation, k),
      events: cell("e", ttj.events, k),
      stillSearchingOrUnknown: cell("c", ttj.censored, k),
      startedBeforeGraduation: cell("b", ttj.startedBeforeGraduation, k),
      p25: ttjSuppressed ? null : ttj.p25,
      median: ttjSuppressed ? null : ttj.median,
      p75: ttjSuppressed ? null : ttj.p75,
      suppressed: ttjSuppressed,
      curve: ttjSuppressed ? [] : ttj.curve.map(({ month, pctEmployed }) => ({ month, pctEmployed })),
    },
    // A cohort curve point is shown only while at least k graduates are still observed.
    curvesByCohort: cohortRows.map((c) => ({
      cohortId: c.id, name: c.name, graduates: c.n,
      curve: c.curve.curve.map((p) => ({ month: p.month, pctEmployed: p.atRisk >= k || p.month === 0 ? p.pctEmployed : null })),
    })),
    topEmployers: named.map(({ name, isPartner, hires: h }) => ({ name, isPartner, hires: h })),
    otherEmployers: { hires: cell("other", other.reduce((a, o) => a + o.hires, 0), k), companies: other.length },
    partnerSplit: suppressGroup([
      { key: "partner" as const, n: hires.filter((h) => h.isPartner).reduce((a, h) => a + h.hires, 0) },
      { key: "non_partner" as const, n: hires.filter((h) => !h.isPartner).reduce((a, h) => a + h.hires, 0) },
    ], k),
    roles: suppressGroup(roles.map(([key, n]) => ({ key, n })), k),
    salaryBands: suppressGroup(SALARY_ORDER.filter((b) => bands.has(b)).map((key) => ({ key, n: bands.get(key)! })), k),
    cohorts: cohortRows.map(({ curve: _c, n: _n, ...row }) => row),
  };
}
