import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { getOpening } from "@/server/services/openings";
import { candidatesForOpening, listReferrals } from "@/server/services/placement";
import { can } from "@/domain/rbac/permissions";
import { enumLabel } from "@/i18n";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { STATUS_TONE } from "../status-tone";
import { NotifyButton } from "./NotifyButton";
import { openingStatusAction } from "../actions";

const REASON_LABEL = { not_searching: "not searching", no_matching_consent: "no job-matching consent", location: "location doesn't fit", missing_must_have: "missing a must-have skill" } as const;

export default async function OpeningDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("opening:read");
  const { id } = await params;
  const [o, matches, refs] = await Promise.all([getOpening(ctx, id), candidatesForOpening(ctx, id), listReferrals(ctx, { status: "all", openingId: id })]);
  const canWrite = can(ctx.actor.role, "opening:write");
  const statusBtn = (action: Parameters<typeof openingStatusAction>[1], label: string, variant: "primary" | "secondary" | "danger" = "secondary") => (
    <form action={openingStatusAction.bind(null, o.id, action)}><Button type="submit" variant={variant}>{label}</Button></form>
  );
  const excluded = Object.entries(matches.excludedByReason).filter(([, n]) => n > 0);
  return (
    <>
      <PageHeader title={o.title} description={<>{o.company.canonicalName} · {enumLabel("remoteMode", o.remoteMode)}{o.city && ` · ${o.city}`} · {o.seniority}{o.deadline && ` · apply by ${fmtDate(o.deadline)}`}</>}
        actions={canWrite && <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS_TONE[o.status]} className="self-center">{o.status.replace("_", " ")}</Badge>
          {o.status === "pending_moderation" && <>{statusBtn("approve", "Approve", "primary")}{statusBtn("reject", "Reject", "danger")}</>}
          {o.status === "open" && <>{statusBtn("pause", "Pause")}{statusBtn("close", "Close")}</>}
          {(o.status === "paused" || o.status === "closed") && statusBtn("reopen", "Reopen")}
          <LinkButton href={`/openings/${o.id}/edit`}>Edit</LinkButton>
        </div>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-1">
          <p className="whitespace-pre-line text-sm">{o.description}</p>
          <h3 className="mt-4 text-sm font-semibold">Skills</h3>
          <ul className="mt-1 flex flex-wrap gap-1">{o.skills.map((s) => <li key={s.skillId}><Badge tone={s.mustHave ? "accent" : "neutral"}>{s.skill.canonicalName} · {s.weight}{s.mustHave && " · must"}</Badge></li>)}</ul>
          {o.submittedBy && <p className="mt-3 text-xs text-muted">Submitted by {o.submittedBy.name} via the partner form.</p>}
        </Card>
        <Card title={`Ranked candidates (${matches.ranked.length})`} className="lg:col-span-2">
          {excluded.length > 0 && <p className="mb-3 text-xs text-muted">Not shown among searching graduates: {excluded.map(([r, n]) => `${n} ${REASON_LABEL[r as keyof typeof REASON_LABEL]}`).join(" · ")}.</p>}
          {matches.ranked.length === 0 ? <EmptyState>No graduate currently passes the filters for this opening.</EmptyState> : (
            <Table caption="Ranked candidates with explanations">
              <thead><tr><Th>#</Th><Th>Graduate</Th><Th>Score</Th><Th>Why</Th><Th>Status</Th></tr></thead>
              <tbody>{matches.ranked.map((m, i) => (
                <tr key={m.candidateId}>
                  <Td>{i + 1}</Td>
                  <Td><Link className="font-medium text-accent underline" href={`/graduates/${m.candidateId}`}>{m.graduate.preferredName ?? m.graduate.fullName}</Link><p className="text-xs text-muted">{m.graduate.cohort.name}</p></Td>
                  <Td><span className="text-lg font-semibold">{m.score}</span><span className="text-xs text-muted">/100</span></Td>
                  <Td><ul className="space-y-0.5 text-xs">{m.explanation.map((e) => <li key={e}>{e}</li>)}</ul></Td>
                  <Td>{m.referralStatus ? <Badge>{enumLabel("referral", m.referralStatus)}</Badge>
                    : o.status === "open" && can(ctx.actor.role, "referral:write") ? <NotifyButton openingId={o.id} graduateId={m.candidateId} name={m.graduate.fullName} /> : "—"}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </div>
      <Card title={`Referrals for this opening (${refs.rows.length})`} className="mt-4">
        {refs.rows.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="divide-y divide-border text-sm">{refs.rows.map((r) => (
            <li key={r.id} className="flex justify-between py-2"><Link className="text-accent underline" href={`/graduates/${r.graduate.id}`}>{r.graduate.fullName}</Link><Badge>{enumLabel("referral", r.status)}</Badge></li>
          ))}</ul>
        )}
        <Link href="/referrals" className="mt-3 inline-block text-sm underline">Open the referral board</Link>
      </Card>
    </>
  );
}
