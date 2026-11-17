import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { listDeadLetters, surveyResponseStats } from "@/server/services/surveys";
import { can } from "@/domain/rbac/permissions";
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { METRIC_DEFINITIONS } from "@/domain/metrics/definitions";
import { dismissAction, retryAction } from "./actions";

export const metadata = { title: "Surveys" };
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export default async function SurveysPage() {
  const ctx = await requireStaffPage("survey:read");
  const stats = await surveyResponseStats(ctx);
  const dead = can(ctx.actor.role, "survey:manage") ? await listDeadLetters(ctx) : [];
  return (
    <>
      <PageHeader title="Check-in surveys" description="Surveys go out automatically at 1, 3, 6 and 12 months after graduation, with up to two reminders." />
      <p className="mb-4 text-sm text-muted"><strong>Response rate</strong> — {METRIC_DEFINITIONS.surveyResponseRate}</p>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title={`By milestone · overall ${pct(stats.totals.rate)}`}>
          <Table caption="Response rate by milestone">
            <thead><tr><Th>Milestone</Th><Th>Went out</Th><Th>Responded</Th><Th>Rate</Th><Th>Scheduled</Th></tr></thead>
            <tbody>{stats.byMilestone.map((m) => (
              <tr key={m.milestone}><Td>{m.milestone} month{m.milestone > 1 ? "s" : ""}</Td><Td>{m.eligible}</Td><Td>{m.responded}</Td><Td className="font-semibold">{pct(m.rate)}</Td><Td>{(m.byStatus.scheduled ?? 0) + (m.byStatus.queued ?? 0)}</Td></tr>
            ))}</tbody>
          </Table>
        </Card>
        <Card title="By cohort">
          <Table caption="Response rate by cohort">
            <thead><tr><Th>Cohort</Th><Th>Went out</Th><Th>Responded</Th><Th>Rate</Th><Th>Bounced</Th></tr></thead>
            <tbody>{stats.byCohort.map((c) => (
              <tr key={c.cohort}><Td>{c.cohort}</Td><Td>{c.eligible}</Td><Td>{c.responded}</Td><Td className="font-semibold">{pct(c.rate)}</Td><Td>{c.byStatus.bounced ?? 0}</Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      </div>

      {can(ctx.actor.role, "survey:manage") && (
        <Card title={`Failed emails (${dead.length})`}>
          <p className="mb-3 text-sm text-muted">
            <strong>Dead</strong>: failed permanently or after 5 attempts. <strong>Uncertain</strong>: the worker stopped mid-send and the provider can&rsquo;t de-duplicate, so it was not resent automatically.
            Retrying an uncertain email might deliver it twice.
          </p>
          {dead.length === 0 ? <EmptyState>No failed emails.</EmptyState> : (
            <Table caption="Failed emails">
              <thead><tr><Th>Graduate</Th><Th>Email</Th><Th>State</Th><Th>Attempts</Th><Th>Last error</Th><Th>Updated</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>{dead.map((d) => (
                <tr key={d.id}>
                  <Td>{d.graduate ? <Link className="text-accent underline" href={`/graduates/${d.graduate.id}`}>{d.graduate.fullName}</Link> : "—"}</Td>
                  <Td>{d.kind.replace(/_/g, " ")}</Td>
                  <Td><Badge tone={d.state === "dead" ? "danger" : "warning"}>{d.state}</Badge></Td>
                  <Td>{d.attempts}</Td>
                  <Td className="max-w-xs text-xs">{d.lastError}</Td>
                  <Td className="text-xs">{fmtDateTime(d.updatedAt)}</Td>
                  <Td><div className="flex gap-2">
                    <form action={retryAction.bind(null, d.id)}><Button type="submit" variant="secondary">Retry</Button></form>
                    <form action={dismissAction.bind(null, d.id)}><Button type="submit" variant="ghost">Dismiss</Button></form>
                  </div></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
