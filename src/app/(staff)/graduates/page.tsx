import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/session";
import { listGraduates, listSkillsForFilter } from "@/server/services/graduates";
import { listCohorts } from "@/server/services/cohorts";
import { EMPLOYMENT_STATUSES } from "@/domain/enums";
import { STALE_AFTER_DAYS } from "@/domain/records/staleness";
import { enumLabel, t } from "@/i18n";
import { Badge, Button, EmptyState, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Graduates" };

export default async function GraduatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireStaffPage("graduate:read");
  const sp = await searchParams;
  const [result, cohorts, skills] = await Promise.all([listGraduates(ctx, sp), listCohorts(ctx), listSkillsForFilter(ctx)]);
  const f = result.filters;
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/graduates?${p}`;
  };

  return (
    <>
      <PageHeader
        title={f.stale ? t("graduates.stale") : t("graduates.title")}
        description={f.stale ? t("graduates.staleHelp", { days: STALE_AFTER_DAYS }) : `${result.total} graduates`}
        actions={<>
          {f.stale ? <LinkButton href="/graduates">All graduates</LinkButton> : <LinkButton href="/graduates?stale=1">{t("graduates.stale")}</LinkButton>}
          <LinkButton href="/graduates/new" variant="primary">{t("graduates.newGraduate")}</LinkButton>
        </>}
      />

      <form method="get" className="mb-4 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter graduates">
        {f.stale && <input type="hidden" name="stale" value="1" />}
        <div><label htmlFor="q" className="text-sm font-medium">{t("graduates.searchLabel")}</label><Input id="q" name="q" defaultValue={f.q ?? ""} /></div>
        <div><label htmlFor="cohortId" className="text-sm font-medium">Cohort</label>
          <Select id="cohortId" name="cohortId" defaultValue={f.cohortId ?? ""}><option value="">All cohorts</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><label htmlFor="status" className="text-sm font-medium">Status</label>
          <Select id="status" name="status" defaultValue={f.status ?? ""}><option value="">Any status</option>{EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{enumLabel("status", s)}</option>)}</Select></div>
        <div><label htmlFor="inField" className="text-sm font-medium">In field</label>
          <Select id="inField" name="inField" defaultValue={f.inField ?? ""}><option value="">Any</option><option value="yes">In field</option><option value="no">Out of field</option></Select></div>
        <div><label htmlFor="skillId" className="text-sm font-medium">Skill</label>
          <Select id="skillId" name="skillId" defaultValue={f.skillId ?? ""}><option value="">Any skill</option>{skills.map((s) => <option key={s.id} value={s.id}>{s.canonicalName}</option>)}</Select></div>
        {!f.stale && <div><label htmlFor="updated" className="text-sm font-medium">Last updated</label>
          <Select id="updated" name="updated" defaultValue={f.updated ?? ""}>
            <option value="">Any time</option><option value="lt30">Within 30 days</option><option value="lt90">Within 90 days</option>
            <option value="gt90">More than 90 days ago</option><option value="gt180">More than 180 days ago</option><option value="never">Never</option>
          </Select></div>}
        <div><label htmlFor="sort" className="text-sm font-medium">Sort</label>
          <Select id="sort" name="sort" defaultValue={f.sort}><option value="name">Name</option><option value="updated_asc">Oldest update first</option><option value="updated_desc">Newest update first</option></Select></div>
        <div className="flex items-end gap-2"><Button type="submit">Apply</Button><LinkButton href={f.stale ? "/graduates?stale=1" : "/graduates"} variant="ghost">Reset</LinkButton></div>
      </form>

      {result.rows.length === 0 ? <EmptyState>{t("graduates.noResults")}</EmptyState> : (
        <Table caption="Graduates matching the filters">
          <thead><tr><Th>Name</Th><Th>Cohort</Th><Th>Status</Th><Th>Top skills</Th><Th>{t("graduates.lastUpdate")}</Th></tr></thead>
          <tbody>
            {result.rows.map((g) => (
              <tr key={g.id} className="hover:bg-surface-2">
                <Td><Link className="font-medium text-accent underline-offset-2 hover:underline" href={`/graduates/${g.id}`}>{g.preferredName ? `${g.preferredName} (${g.fullName})` : g.fullName}</Link></Td>
                <Td>{g.cohort.name}</Td>
                <Td><div className="flex flex-wrap gap-1"><StatusBadge status={g.currentStatus} />{g.currentInField === false && <Badge>Out of field</Badge>}</div>
                  {g.searchingSince && <p className="mt-1 text-xs text-muted">Searching since {fmtDate(g.searchingSince)}</p>}</Td>
                <Td className="text-xs">{g.skills.map((s) => `${s.skill.canonicalName} (${s.level})`).join(", ") || "—"}</Td>
                <Td><span title={fmtDate(g.currentStatusAt)}>{g.currentStatusAt ? relativeDays(g.currentStatusAt) : t("graduates.never")}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(p) => qs({ page: p })} />
    </>
  );
}
