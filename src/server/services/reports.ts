/**
 * Outcomes reporting. Everything returned from here is an aggregate that already passed the
 * privacy rules in src/domain/metrics/report.ts — safe for Leadership/Marketing.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { EMPLOYED_STATUSES } from "@/domain/enums";
import { buildOutcomesReport, type OutcomesReport } from "@/domain/metrics/report";
import type { ReportGraduate } from "@/domain/metrics/outcomes";
import { enumLabel } from "@/i18n";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { getSetting } from "../settings";

const month = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}$/).optional().catch(undefined));
export const reportFiltersSchema = z.object({
  programId: z.preprocess((v) => v || undefined, z.string().max(40).optional()),
  cohortId: z.preprocess((v) => v || undefined, z.string().max(40).optional()),
  from: month, // graduation month from (inclusive)
  to: month, // graduation month to (inclusive)
  count: z.preprocess((v) => (v == null ? undefined : Array.isArray(v) ? v : [v]), z.array(z.enum(EMPLOYED_STATUSES)).min(1).optional().catch(undefined)),
  inField: z.preprocess((v) => v === "1" || v === true, z.boolean()).default(false),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

/** Filters select whole cohorts (never individual graduates), so results can't be differenced below cohort level. */
function cohortWhere(f: ReportFilters): Prisma.CohortWhereInput {
  const gd: Prisma.DateTimeNullableFilter = {};
  if (f.from) gd.gte = new Date(`${f.from}-01T00:00:00Z`);
  if (f.to) {
    const [y, m] = f.to.split("-").map(Number);
    gd.lt = new Date(Date.UTC(y!, m!, 1));
  }
  return { ...(f.programId ? { programId: f.programId } : {}), ...(f.cohortId ? { id: f.cohortId } : {}), ...(f.from || f.to ? { graduationDate: gd } : {}) };
}

async function loadFacts(f: ReportFilters) {
  const cohorts = await prisma.cohort.findMany({ where: cohortWhere(f), include: { program: true } });
  const ids = cohorts.map((c) => c.id);
  const grads = await prisma.graduate.findMany({
    where: { cohortId: { in: ids } },
    select: {
      id: true, cohortId: true, graduationDateOverride: true,
      consents: { where: { purpose: "outcomes_reporting", revokedAt: null }, select: { id: true } },
      employmentRecords: { select: { status: true, reportedAt: true, startDate: true, companyId: true, inField: true, roleCategory: true, salaryBand: true } },
    },
  });
  const gradDate = new Map(cohorts.map((c) => [c.id, c.graduationDate]));
  const facts: ReportGraduate[] = grads.map((g) => ({
    id: g.id,
    cohortId: g.cohortId,
    graduationDate: g.graduationDateOverride ?? gradDate.get(g.cohortId) ?? null,
    includeInReporting: g.consents.length > 0,
    records: g.employmentRecords,
  }));
  const companies = await prisma.company.findMany({ select: { id: true, canonicalName: true, isPartner: true } });
  return {
    facts,
    cohorts: cohorts.map((c) => ({ id: c.id, name: c.name, programId: c.programId, programName: c.program.name, graduationDate: c.graduationDate })),
    companies: companies.map((c) => ({ id: c.id, name: c.canonicalName, isPartner: c.isPartner })),
  };
}

export async function getOutcomesReport(ctx: RequestContext, raw: unknown, now = new Date()): Promise<{ filters: ReportFilters; report: OutcomesReport }> {
  requirePermission(ctx, "report:read");
  const filters = reportFiltersSchema.parse(raw ?? {});
  const cfg = await getSetting("reporting");
  const { facts, cohorts, companies } = await loadFacts(filters);
  const report = buildOutcomesReport(facts, cohorts, companies, now, { ...cfg, employedStatuses: filters.count ?? cfg.employedStatuses });
  return { filters, report };
}

/** Filter options (program and cohort names only — no counts, no people). */
export async function reportFilterOptions(ctx: RequestContext) {
  requirePermission(ctx, "report:read");
  const [programs, cohorts] = await Promise.all([
    prisma.program.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.cohort.findMany({ orderBy: { graduationDate: "asc" }, select: { id: true, name: true, programId: true } }),
  ]);
  return { programs, cohorts };
}

// ─── Exports (all audited) ───

const pctOrDisplay = (r: { value: number | null; display: string }) => (r.value === null ? r.display : (r.value * 100).toFixed(1) + "%");

export function reportToCsv(r: OutcomesReport): string {
  const rows: string[][] = [["section", "group", "measure", "value"]];
  const add = (section: string, group: string, measure: string, value: string | number | null) => rows.push([section, group, measure, value === null ? "" : String(value)]);
  add("population", "all", "graduates included", r.population.graduates.display);
  add("population", "all", "excluded: no reporting consent", r.population.excludedNoConsent.display);
  add("population", "all", "excluded: cohorts smaller than minimum", r.population.excludedSmallCohorts.display);
  add("freshness", "all", "updated in last 90 days", pctOrDisplay(r.freshness));
  for (const m of r.milestones) {
    const g = `${m.months} months`;
    add("employment", g, "graduates at milestone", m.population.display);
    add("employment", g, "employment rate (of known status)", pctOrDisplay(m.employmentRate));
    add("employment", g, "employment rate in field", pctOrDisplay(m.employmentRateInField));
    add("employment", g, "employment rate lower bound (unknown = not employed)", pctOrDisplay(m.employmentRateLowerBound));
    add("employment", g, "response rate", pctOrDisplay(m.responseRate));
    add("employment", g, "unknown status", m.unknown.display);
    for (const b of m.breakdown) add("employment", g, `status: ${enumLabel("status", b.key)}`, b.display);
  }
  const t = r.timeToJob;
  add("time to first job", "all", "median days", t.median ?? (t.suppressed ? "suppressed" : "not reached"));
  add("time to first job", "all", "25th percentile days", t.p25 ?? (t.suppressed ? "suppressed" : "not reached"));
  add("time to first job", "all", "75th percentile days", t.p75 ?? (t.suppressed ? "suppressed" : "not reached"));
  for (const p of t.curve) add("time to first job", "all", `employed by month ${p.month}`, (p.pctEmployed * 100).toFixed(1) + "%");
  for (const c of r.curvesByCohort) for (const p of c.curve) add("time to first job", c.name, `employed by month ${p.month}`, p.pctEmployed === null ? "suppressed" : (p.pctEmployed * 100).toFixed(1) + "%");
  for (const e of r.topEmployers) add("top employers", e.isPartner ? "partner" : "non-partner", e.name, e.hires);
  add("top employers", "all", "other employers (graduates)", r.otherEmployers.hires.display);
  for (const s of r.partnerSplit) add("employers", s.key, "graduates", s.display);
  for (const x of r.roles) add("roles", "currently employed", enumLabel("role", x.key), x.display);
  for (const x of r.salaryBands) add("salary bands", "currently employed", x.key === "not_stated" ? "Not stated" : enumLabel("salary", x.key), x.display);
  for (const c of r.cohorts) {
    add("cohorts", c.name, "graduates", c.graduates.display);
    add("cohorts", c.name, "response rate 6m", pctOrDisplay(c.responseRate6));
    add("cohorts", c.name, "employment rate 6m", pctOrDisplay(c.rate6));
    add("cohorts", c.name, "employment rate 12m", pctOrDisplay(c.rate12));
    add("cohorts", c.name, "median days to first job", c.medianDays ?? "");
  }
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v); // CSV-injection safe
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

export async function exportReport(ctx: RequestContext, raw: unknown, format: "csv" | "pdf") {
  requirePermission(ctx, "report:export");
  const { filters, report } = await getOutcomesReport(ctx, raw);
  await audit(prisma, ctx, { action: "report.export", entityType: "Report", meta: { format, filters } });
  if (format === "csv") return { contentType: "text/csv; charset=utf-8", body: reportToCsv(report), filename: "alumni-outcomes.csv" };
  const { renderReportPdf } = await import("../pdf/report-pdf");
  return { contentType: "application/pdf", body: await renderReportPdf(report, filters), filename: "alumni-outcomes.pdf" };
}

/** PNG charts are rendered in the browser; the download is logged here first. */
export async function logChartExport(ctx: RequestContext, chart: string, raw: unknown) {
  requirePermission(ctx, "report:export");
  const filters = reportFiltersSchema.parse(raw ?? {});
  await audit(prisma, ctx, { action: "report.export", entityType: "Report", meta: { format: "png", chart: z.string().max(60).parse(chart), filters } });
}
