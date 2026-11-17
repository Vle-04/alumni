"use client";
import type { OutcomesReport } from "@/domain/metrics/report";
import { METRIC_DEFINITIONS as DEF } from "@/domain/metrics/definitions";
import { enumLabel } from "@/i18n";
import { ChartCard } from "@/components/charts/ChartCard";
import { CurveChart, GroupedRate, HBar, VBar } from "@/components/charts/Charts";
import { InfoTip } from "@/components/InfoTip";
import { logChartExportAction } from "./actions";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Tile({ label, def, value, lines }: { label: string; def: string; value: string; lines: React.ReactNode[] }) {
  return (
    <div role="group" aria-label={label} className="rounded-lg border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-sm text-muted">{label}<InfoTip label={label} text={def} /></p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      <ul className="mt-2 space-y-0.5 text-xs text-muted">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

export function ReportView({ r, filters, canExport, cohortSlots }: { r: OutcomesReport; filters: Record<string, unknown>; canExport: boolean; cohortSlots: Record<string, number> }) {
  const onExport = canExport ? (chart: string) => logChartExportAction(chart, filters) : undefined;
  const inField = Boolean(filters.inField);
  const t = r.timeToJob;

  const milestoneTile = (m: OutcomesReport["milestones"][number]) => (
    <Tile key={m.months} label={`Employed at ${m.months} months${inField ? " (in field)" : ""}`} def={inField ? DEF.inField : DEF.employmentRate}
      value={(inField ? m.employmentRateInField : m.employmentRate).display}
      lines={[
        <>Response rate <strong>{m.responseRate.display}</strong> · unknown <strong>{m.unknown.display}</strong> of {m.population.display}</>,
        <>If every unknown were not employed: <strong>{m.employmentRateLowerBound.display}</strong> <InfoTip label="lower bound" text={DEF.employmentRateLowerBound} /></>,
        ...(inField ? [<>In-field not stated: {m.inFieldUnknown.display}</>] : []),
      ]} />
  );

  const cohortsCharted = r.curvesByCohort.filter((c) => cohortSlots[c.cohortId] !== undefined);
  const curveData = Array.from({ length: 13 }, (_, month) => {
    const row: Record<string, number | null> = { month, all: t.curve[month]?.pctEmployed ?? null };
    for (const c of cohortsCharted) row[c.cohortId] = c.curve[month]?.pctEmployed ?? null;
    return row;
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {r.milestones.map(milestoneTile)}
        <Tile label="Median time to first job" def={DEF.timeToFirstJob}
          value={t.median !== null ? `${t.median} days` : t.suppressed ? "—" : "Not reached"}
          lines={[
            t.p25 !== null ? <>25th–75th percentile: <strong>{t.p25}–{t.p75 ?? "not reached"}</strong> days</> : "Percentiles not available",
            <>{t.events.display} found work · {t.stillSearchingOrUnknown.display} not yet</>,
            <>Started before graduating (counted as day 0): {t.startedBeforeGraduation.display}</>,
          ]} />
        <Tile label="Data freshness" def={DEF.freshness} value={r.freshness.display} lines={[<>of {r.population.graduates.display} graduates updated in the last 90 days</>]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {r.milestones.map((m) => {
          const rows = m.breakdown.filter((b) => b.n !== 0 || b.suppressed);
          return (
            <ChartCard key={m.months} id={`status-${m.months}m`} title={`Status at ${m.months} months`} definition={DEF.statusAtMilestone} onExport={onExport}
              note={<>Includes unknowns so non-responders are never silently dropped. Hidden bars are groups under {r.config.minCell}.</>}
              table={{ caption: `Status at ${m.months} months`, columns: ["Status", "Graduates"], rows: rows.map((b) => [enumLabel("status", b.key), b.display]) }}>
              <HBar data={rows.map((b) => ({ label: enumLabel("status", b.key), value: b.n }))} valueLabel="Graduates" />
            </ChartCard>
          );
        })}
      </div>

      {!t.suppressed && (
        <ChartCard id="employed-by-month" title="Employed by month after graduation" definition={DEF.employedByMonth} onExport={onExport}
          note={cohortsCharted.length < r.curvesByCohort.length ? "The six most recent cohorts are charted; all cohorts are in the data table." : "Lines step up when graduates start a job. Graduates still searching are counted, not dropped."}
          table={{
            caption: "Share employed by month",
            columns: ["Month", "All", ...r.curvesByCohort.map((c) => c.name)],
            rows: curveData.map((row, i) => [row.month!, pct(row.all ?? 0), ...r.curvesByCohort.map((c) => (c.curve[i]?.pctEmployed === null || c.curve[i] === undefined ? "hidden" : pct(c.curve[i]!.pctEmployed!)))]),
          }}>
          <CurveChart data={curveData} series={cohortsCharted.map((c) => ({ key: c.cohortId, label: c.name, slot: cohortSlots[c.cohortId]! }))} />
        </ChartCard>
      )}

      <ChartCard id="cohort-comparison" title="Cohort comparison" definition={DEF.employmentRate} onExport={onExport}
        note="Cohorts in order of graduation. Rates hidden for small groups. Recent cohorts appear once their milestone has passed."
        table={{
          caption: "Cohort comparison",
          columns: ["Cohort", "Program", "Graduated", "Graduates", "Response 6m", "Employed 6m", "Employed 12m", "Median days to job"],
          rows: r.cohorts.map((c) => [c.name, c.programName, c.graduationDate ?? "—", c.graduates.display, c.responseRate6.display, c.rate6.display, c.rate12.display, c.medianDays ?? "—"]),
        }}>
        <GroupedRate data={r.cohorts.map((c) => ({ label: c.name, m6: c.rate6.value, m12: c.rate12.value }))} series={[{ key: "m6", label: "Employed at 6 months" }, { key: "m12", label: "Employed at 12 months" }]} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard id="top-employers" title="Top employers" definition={DEF.topEmployers} onExport={onExport}
          note={<>Partner vs non-partner: {r.partnerSplit.map((p) => `${p.key === "partner" ? "partners" : "non-partners"} ${p.display}`).join(" · ")}. Other employers: {r.otherEmployers.hires.display} graduates at {r.otherEmployers.companies} companies.</>}
          table={{ caption: "Top employers", columns: ["Employer", "Partner", "Graduates"], rows: [...r.topEmployers.map((e) => [e.name, e.isPartner ? "Yes" : "No", e.hires]), ["Other employers", "—", r.otherEmployers.hires.display]] }}>
          {r.topEmployers.length ? <HBar data={r.topEmployers.map((e) => ({ label: e.isPartner ? `${e.name} (partner)` : e.name, value: e.hires }))} valueLabel="Graduates" />
            : <p className="text-sm text-muted">No employer has {r.config.minCell} or more graduates yet.</p>}
        </ChartCard>
        <ChartCard id="roles" title="Roles of employed graduates" definition={DEF.roles} onExport={onExport}
          table={{ caption: "Roles", columns: ["Role", "Graduates"], rows: r.roles.map((x) => [x.key === "not_stated" ? "Not stated" : enumLabel("role", x.key), x.display]) }}>
          <HBar data={r.roles.map((x) => ({ label: x.key === "not_stated" ? "Not stated" : enumLabel("role", x.key), value: x.n }))} valueLabel="Graduates" />
        </ChartCard>
      </div>

      <ChartCard id="salary-bands" title="Monthly salary bands" definition={DEF.salaryBands} onExport={onExport}
        table={{ caption: "Salary bands", columns: ["Band", "Graduates"], rows: r.salaryBands.map((x) => [x.key === "not_stated" ? "Not stated" : enumLabel("salary", x.key), x.display]) }}>
        <VBar data={r.salaryBands.map((x) => ({ label: x.key === "not_stated" ? "Not stated" : enumLabel("salary", x.key), value: x.n }))} valueLabel="Graduates" />
      </ChartCard>
    </div>
  );
}
