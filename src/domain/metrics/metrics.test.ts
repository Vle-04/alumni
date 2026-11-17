import { describe, expect, it } from "vitest";
import { cell, safeRate, suppressGroup } from "./suppression";
import { DEFAULT_REPORT_CONFIG, employmentAtMilestone, kaplanMeier, statusAtMilestone, timeToFirstJob, freshness, type ReportGraduate, type ReportRecord } from "./outcomes";
import { buildOutcomesReport } from "./report";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = D("2026-11-01");
const rec = (status: ReportRecord["status"], reportedAt: string, o: Partial<ReportRecord> = {}): ReportRecord => ({
  status, reportedAt: D(reportedAt), startDate: null, companyId: null, inField: null, roleCategory: null, salaryBand: null, ...o,
});
let n = 0;
const grad = (records: ReportRecord[], o: Partial<ReportGraduate> = {}): ReportGraduate => ({ id: `g${++n}`, cohortId: "c1", graduationDate: D("2025-06-30"), includeInReporting: true, records, ...o });

describe("suppression", () => {
  it("shows 0 and ≥5, hides 1–4", () => {
    expect([0, 1, 4, 5].map((x) => cell("k", x).display)).toEqual(["0", "<5", "<5", "5"]);
  });
  it("adds secondary suppression when a single hidden cell could be recovered from the total", () => {
    const g = suppressGroup([{ key: "a", n: 20 }, { key: "b", n: 3 }, { key: "c", n: 9 }, { key: "d", n: 0 }]);
    expect(g.map((c) => c.suppressed)).toEqual([false, true, true, false]); // c (next smallest non-zero) hidden too
    expect(g[3]!.display).toBe("0");
  });
  it("does not add extra suppression when two or more cells are already hidden", () => {
    const g = suppressGroup([{ key: "a", n: 20 }, { key: "b", n: 3 }, { key: "c", n: 2 }]);
    expect(g.map((c) => c.suppressed)).toEqual([false, true, true]);
  });
  it("hides rates that would reveal a small group", () => {
    expect(safeRate(40, 50)).toMatchObject({ display: "80%", suppressed: false });
    expect(safeRate(2, 50)).toMatchObject({ suppressed: true, display: "<10%", value: null }); // 2 people → bound only
    expect(safeRate(48, 50)).toMatchObject({ suppressed: true, display: ">90%" }); // complement: 2 people
    expect(safeRate(3, 4)).toMatchObject({ suppressed: true, display: "Group too small" });
    expect(safeRate(0, 10)).toMatchObject({ display: "0%", suppressed: false });
    expect(safeRate(0, 0).display).toBe("—");
  });
});

describe("status at milestone", () => {
  // graduation 2025-06-30 → 6 months = 2025-12-30; window 2025-10-01 … 2026-02-13
  it("uses the latest record inside the window", () => {
    const g = grad([rec("searching", "2025-11-01"), rec("employed_full_time", "2026-01-20", { startDate: D("2025-12-01") }), rec("searching", "2026-05-01")]);
    expect(statusAtMilestone(g, 6)?.status).toBe("employed_full_time");
  });
  it("is unknown without a record in the window", () => {
    expect(statusAtMilestone(grad([rec("employed_full_time", "2026-06-01")]), 6)).toBeNull();
  });
  it("ignores jobs that started after the milestone", () => {
    const g = grad([rec("searching", "2025-12-01"), rec("employed_full_time", "2026-02-01", { startDate: D("2026-01-15") })]);
    expect(statusAtMilestone(g, 6)?.status).toBe("searching");
  });
});

describe("employment rate", () => {
  const cohort = [
    grad([rec("employed_full_time", "2025-12-20", { inField: true })]),
    grad([rec("employed_part_time", "2025-12-20", { inField: false })]),
    grad([rec("internship", "2025-12-20")]),
    grad([rec("searching", "2025-12-20")]),
    grad([]), // non-responder: unknown
    grad([rec("employed_full_time", "2025-12-20")], { includeInReporting: false }), // no consent: excluded
    grad([rec("employed_full_time", "2026-10-20")], { graduationDate: D("2026-08-01") }), // milestone not reached yet
  ];
  it("divides employed by KNOWN status and keeps unknowns visible", () => {
    const m = employmentAtMilestone(cohort, 6, NOW);
    expect(m).toMatchObject({ population: 5, known: 4, unknown: 1, employed: 3, employedInField: 1, employedInFieldUnknown: 1 });
    expect(m.byStatus).toMatchObject({ employed_full_time: 1, employed_part_time: 1, internship: 1, searching: 1, unknown: 1 });
  });
  it("lets the employed statuses be configured", () => {
    const m = employmentAtMilestone(cohort, 6, NOW, { ...DEFAULT_REPORT_CONFIG, employedStatuses: ["employed_full_time"] });
    expect(m.employed).toBe(1);
  });
});

describe("Kaplan–Meier", () => {
  it("matches a hand computation with censoring", () => {
    // events at 10, 20 (×2), 40; censored at 15, 30
    const km = kaplanMeier([{ days: 10, event: true }, { days: 15, event: false }, { days: 20, event: true }, { days: 20, event: true }, { days: 30, event: false }, { days: 40, event: true }]);
    // S(10)=5/6; S(20)=5/6·(1−2/4)=5/12; S(40)=5/12·(1−1/1)=0
    expect(km.at(10)).toBeCloseTo(1 / 6);
    expect(km.at(25)).toBeCloseTo(7 / 12);
    expect(km.at(40)).toBeCloseTo(1);
    expect(km.quantile(0.5)).toBe(20);
    expect(km.quantile(0.25)).toBe(20);
  });
  it("does not reach the median when most graduates are still searching", () => {
    const km = kaplanMeier([{ days: 30, event: true }, { days: 100, event: false }, { days: 100, event: false }, { days: 100, event: false }]);
    expect(km.quantile(0.5)).toBeNull();
    expect(km.at(365)).toBeCloseTo(0.25);
  });
  it("counts non-finders instead of averaging only those who succeeded", () => {
    const grads = [
      grad([rec("employed_full_time", "2025-08-01", { startDate: D("2025-07-30") })]), // 30 days
      grad([rec("employed_full_time", "2025-10-01", { startDate: D("2025-09-28") })]), // 90 days
      grad([rec("searching", "2026-06-30")]), // censored at 365
      grad([rec("searching", "2026-06-30")]),
      grad([rec("employed_full_time", "2025-06-01", { startDate: D("2025-06-01") })]), // before graduation → day 0
      grad([]), // no information: excluded
    ];
    const t = timeToFirstJob(grads, NOW);
    expect(t).toMatchObject({ withInformation: 5, events: 3, censored: 2, startedBeforeGraduation: 1, median: 90, p25: 30 });
    expect(t.p75).toBeNull(); // only 60% ever observed employed
    expect(t.curve[12]!.pctEmployed).toBeCloseTo(0.6);
  });
  it("excludes internships from 'first job' by default (configurable)", () => {
    const g = [grad([rec("internship", "2025-08-01", { startDate: D("2025-07-30") })])];
    expect(timeToFirstJob(g, NOW).events).toBe(0);
    expect(timeToFirstJob(g, NOW, { ...DEFAULT_REPORT_CONFIG, qualifyingJobStatuses: ["internship"] }).events).toBe(1);
  });
});

describe("freshness", () => {
  it("counts records updated within 90 days", () => {
    expect(freshness([grad([rec("searching", "2026-10-01")]), grad([rec("searching", "2026-01-01")]), grad([])], NOW)).toEqual({ fresh: 1, total: 3 });
  });
});

describe("buildOutcomesReport", () => {
  const cohorts = [
    { id: "big", name: "Big", programId: "p", programName: "P", graduationDate: D("2025-06-30") },
    { id: "tiny", name: "Tiny", programId: "p", programName: "P", graduationDate: D("2025-06-30") },
  ];
  const companies = [{ id: "acme", name: "Acme", isPartner: true }, { id: "solo", name: "Solo Ltd", isPartner: false }];
  const many = (count: number, mk: () => ReportGraduate) => Array.from({ length: count }, mk);
  const grads = [
    ...many(12, () => grad([rec("employed_full_time", "2025-12-20", { startDate: D("2025-10-01"), companyId: "acme", inField: true, roleCategory: "frontend", salaryBand: "band_1000_1500" })], { cohortId: "big" })),
    ...many(5, () => grad([rec("searching", "2025-12-20")], { cohortId: "big" })),
    grad([rec("employed_full_time", "2025-12-20", { startDate: D("2025-10-01"), companyId: "solo", roleCategory: "backend" })], { cohortId: "big" }),
    ...many(3, () => grad([], { cohortId: "big" })),
    ...many(3, () => grad([rec("employed_full_time", "2025-12-20", { companyId: "solo" })], { cohortId: "tiny" })),
  ];
  const r = buildOutcomesReport(grads, cohorts, companies, NOW);

  it("excludes cohorts below the minimum from every figure", () => {
    expect(r.population.graduates.display).toBe("21");
    expect(r.population.excludedSmallCohorts.display).toBe("<5");
    expect(r.cohorts.map((c) => c.name)).toEqual(["Big"]);
    expect(JSON.stringify(r)).not.toContain("Tiny");
  });

  it("always reports the employment rate together with response rate and unknowns", () => {
    const m6 = r.milestones[0]!;
    expect(m6.employmentRate.display).toBe("72%"); // 13 / 18 known
    expect(m6.responseRate.display).toBe(">76%"); // 18 / 21, but 3 unknowns is a small group → bound
    expect(m6.unknown.display).toBe("<5");
    expect(m6.employmentRateLowerBound.display).toBe("62%"); // 13 / 21
  });

  it("names only employers with at least 5 graduates", () => {
    expect(r.topEmployers).toEqual([{ name: "Acme", isPartner: true, hires: 12 }]);
    expect(r.otherEmployers.hires.display).toBe("<5");
    expect(JSON.stringify(r)).not.toContain("Solo Ltd");
  });

  it("suppresses small distribution cells with a secondary cell", () => {
    expect(r.roles.find((x) => x.key === "backend")?.suppressed).toBe(true);
    expect(r.roles.find((x) => x.key === "frontend")?.display).toBe("suppressed"); // would otherwise reveal backend = 13 − 12
  });

  it("flags a report whose filters leave fewer than 5 graduates", () => {
    expect(buildOutcomesReport(grads.slice(0, 3), cohorts, companies, NOW).tooSmall).toBe(true);
  });

  it("contains no graduate identifiers", () => {
    expect(JSON.stringify(r)).not.toMatch(/"g\d+"/);
  });
});
