import type { Metadata } from "next";
import { requireStaffPage } from "@/server/session";
import { getOutcomesReport, reportFilterOptions } from "@/server/services/reports";
import { can } from "@/domain/rbac/permissions";
import { EMPLOYED_STATUSES } from "@/domain/enums";
import { METRIC_DEFINITIONS } from "@/domain/metrics/definitions";
import { enumLabel } from "@/i18n";
import { Alert, Button, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ReportView } from "./ReportView";

export const metadata: Metadata = { title: "Outcomes report" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireStaffPage("report:read");
  const sp = await searchParams;
  const [{ filters, report }, options] = await Promise.all([getOutcomesReport(ctx, sp), reportFilterOptions(ctx)]);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : [v]) qs.append(k, x);
  const counted = filters.count ?? [...EMPLOYED_STATUSES];
  // Colour follows the cohort: slots are assigned over ALL cohorts (latest six), so filtering never repaints a line.
  const latestSix = options.cohorts.slice(-6);
  const cohortSlots = Object.fromEntries(latestSix.map((c, i) => [c.id, i]));
  return (
    <>
      <PageHeader title="Outcomes report" description="Did graduates get jobs? Aggregates only — no individual is identifiable."
        actions={can(ctx.actor.role, "report:export") && <>
          {/* Plain anchors: file downloads need a real navigation, not client-side routing. */}
          <a href={`/api/reports/export?format=pdf&${qs}`} download className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2">Download PDF</a>
          <a href={`/api/reports/export?format=csv&${qs}`} download className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2">Download CSV</a>
        </>} />

      <form method="get" className="mb-6 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Report filters">
        <div><label htmlFor="programId" className="text-sm font-medium">Program</label>
          <Select id="programId" name="programId" defaultValue={filters.programId ?? ""}><option value="">All programs</option>{options.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
        <div><label htmlFor="cohortId" className="text-sm font-medium">Cohort</label>
          <Select id="cohortId" name="cohortId" defaultValue={filters.cohortId ?? ""}><option value="">All cohorts</option>{options.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><label htmlFor="from" className="text-sm font-medium">Graduated from</label><Input id="from" name="from" type="month" defaultValue={filters.from ?? ""} /></div>
        <div><label htmlFor="to" className="text-sm font-medium">Graduated to</label><Input id="to" name="to" type="month" defaultValue={filters.to ?? ""} /></div>
        <div className="flex items-end gap-2"><Button type="submit">Apply</Button><LinkButton href="/reports" variant="ghost">Reset</LinkButton></div>
        <fieldset className="sm:col-span-2 lg:col-span-4">
          <legend className="text-sm font-medium">Count as employed</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {EMPLOYED_STATUSES.map((s) => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" name="count" value={s} defaultChecked={counted.includes(s)} className="size-4" />{enumLabel("status", s)}</label>)}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="inField" value="1" defaultChecked={filters.inField} className="size-4" />In-field jobs only</label>
      </form>

      {report.tooSmall ? <Alert>Fewer than {report.config.minCell} graduates match these filters, so nothing is shown to protect privacy.</Alert> : (
        <ReportView r={report} filters={filters} canExport={can(ctx.actor.role, "report:export")} cohortSlots={cohortSlots} />
      )}

      <p className="mt-6 text-xs text-muted">
        {METRIC_DEFINITIONS.suppression} Left out of all figures: {report.population.excludedNoConsent.display} graduates who didn&rsquo;t agree to outcomes reporting, and {report.population.excludedSmallCohorts.display} in cohorts too small to report. Full definitions: docs/METRICS.md.
      </p>
    </>
  );
}
