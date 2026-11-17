import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { getGraduateDetail } from "@/server/services/graduates";
import { can } from "@/domain/rbac/permissions";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, ROLE_CATEGORIES, SALARY_BANDS } from "@/domain/enums";
import { enumLabel, t } from "@/i18n";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ContactReveal } from "./ContactReveal";
import { RotateLink } from "./RotateLink";
import { AddRecordForm } from "./AddRecordForm";
import { addRecordAction, verifyRecordAction } from "../actions";

export default async function GraduateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaffPage("graduate:read");
  const g = await getGraduateDetail(ctx, id);
  const role = ctx.actor.role;
  const opt = <T extends string>(group: Parameters<typeof enumLabel>[0], vals: readonly T[]) => vals.map((v) => ({ value: v, label: enumLabel(group, v) }));
  const activeConsents = new Set(g.consents.filter((c) => !c.revokedAt).map((c) => c.purpose));

  return (
    <>
      <PageHeader
        title={g.preferredName ? `${g.preferredName} (${g.fullName})` : g.fullName}
        description={<>{g.cohort.program.name} · {g.cohort.name} · graduated {fmtDate(g.effectiveGraduationDate)}</>}
        actions={can(role, "graduate:write") && <LinkButton href={`/graduates/${g.id}/edit`}>Edit profile</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Current status">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={g.currentStatus} />
              <Badge>{enumLabel("jobSearch", g.jobSearchStatus)}</Badge>
              {g.currentInField !== null && <Badge tone={g.currentInField ? "success" : "neutral"}>{g.currentInField ? "In field" : "Out of field"}</Badge>}
              <span className="text-sm text-muted">Last update: {fmtDate(g.currentStatusAt)}</span>
            </div>
            {g.searchingSince && <p className="mt-2 text-sm">Searching since {fmtDate(g.searchingSince)}</p>}
          </Card>

          <Card title="Employment timeline">
            {g.employmentRecords.length === 0 ? <p className="text-sm text-muted">No records yet.</p> : (
              <ol className="space-y-3 border-l-2 border-border pl-4">
                {g.employmentRecords.map((r) => (
                  <li key={r.id} className="relative">
                    <span aria-hidden className="absolute -left-[1.4rem] top-1.5 size-3 rounded-full border-2 border-surface bg-accent" />
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.company && <span className="font-medium">{r.company.canonicalName}</span>}
                      {r.roleTitle && <span>· {r.roleTitle}</span>}
                      {r.inField === true && <Badge tone="success">In field</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Reported {fmtDate(r.reportedAt)} via {enumLabel("source", r.source)}
                      {r.startDate && <> · started {fmtDate(r.startDate)}</>}{r.endDate && <> · ended {fmtDate(r.endDate)}</>}
                      {r.salaryBand && <> · band {enumLabel("salary", r.salaryBand)}</>}
                      {r.verifiedBy ? <> · verified by {r.verifiedBy.name ?? r.verifiedBy.email}</> : null}
                    </p>
                    {(r.searchBlockers.length > 0 || r.helpWanted.length > 0) && (
                      <p className="mt-1 text-xs">Blockers: {r.searchBlockers.join(", ") || "—"} · Help wanted: {r.helpWanted.join(", ") || "—"}</p>
                    )}
                    {!r.verifiedBy && can(role, "employment:write") && (
                      <form action={verifyRecordAction.bind(null, g.id, r.id)}><button className="mt-1 text-xs text-accent underline" type="submit">Mark verified</button></form>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {can(role, "employment:write") && (
            <Card title="Add employment record">
              <AddRecordForm action={addRecordAction.bind(null, g.id)} statuses={opt("status", EMPLOYMENT_STATUSES.filter((s) => s !== "unknown"))}
                roles={opt("role", ROLE_CATEGORIES)} salaryBands={opt("salary", SALARY_BANDS)} types={opt("employmentType", EMPLOYMENT_TYPES)} />
            </Card>
          )}

          <Card title="Surveys">
            {g.surveys.length === 0 ? <p className="text-sm text-muted">No surveys scheduled (cohort has no graduation date yet).</p> : (
              <Table caption="Survey history">
                <thead><tr><Th>Milestone</Th><Th>Status</Th><Th>Scheduled</Th><Th>Sent</Th><Th>Reminders</Th><Th>Completed</Th></tr></thead>
                <tbody>{g.surveys.map((s) => (
                  <tr key={s.id}><Td>{s.milestone} month{s.milestone > 1 ? "s" : ""}</Td><Td>{enumLabel("survey", s.status)}</Td><Td>{fmtDate(s.scheduledFor)}</Td><Td>{fmtDate(s.sentAt)}</Td><Td>{s.reminderCount}</Td><Td>{fmtDate(s.completedAt)}</Td></tr>
                ))}</tbody>
              </Table>
            )}
          </Card>

          <Card title="Referrals">
            {g.referrals.length === 0 ? <p className="text-sm text-muted">No referrals yet.</p> : (
              <ul className="space-y-1 text-sm">{g.referrals.map((r) => (
                <li key={r.id}><Link className="text-accent underline" href={`/openings/${r.openingId}`}>{r.opening.title}</Link> at {r.opening.company.canonicalName} — <Badge>{enumLabel("referral", r.status)}</Badge></li>
              ))}</ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {can(role, "graduate:read_contact") && (
            <Card title="Contact"><ContactReveal id={g.id} has={{ email: g.hasEmail, phone: g.hasPhone, linkedin: g.hasLinkedin }} hiddenNote={t("graduates.contactHidden")} /></Card>
          )}
          <Card title="Profile">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Location</dt><dd>{[g.city, g.country].filter(Boolean).join(", ") || "—"}</dd>
              <dt className="text-muted">Work mode</dt><dd>{enumLabel("remote", g.remotePreference)}{g.openToRelocate && ", open to relocate"}</dd>
              <dt className="text-muted">Roles</dt><dd>{g.preferredRoleCategories.map((r) => enumLabel("role", r)).join(", ") || "—"}</dd>
              <dt className="text-muted">Time zone</dt><dd>{g.timezone ?? "Academy default"}</dd>
            </dl>
            <h3 className="mt-4 text-sm font-semibold">Skills</h3>
            <ul className="mt-1 flex flex-wrap gap-1">{g.skills.length ? g.skills.map((s) => <li key={s.skillId}><Badge>{s.skill.canonicalName} · {s.level}</Badge></li>) : <li className="text-sm text-muted">None</li>}</ul>
          </Card>
          <Card title="Consent">
            <ul className="space-y-1 text-sm">
              {(["outcomes_reporting", "job_matching", "share_with_partners", "marketing_testimonial"] as const).map((p) => (
                <li key={p} className="flex justify-between gap-2"><span>{p.replace(/_/g, " ")}</span><Badge tone={activeConsents.has(p) ? "success" : "neutral"}>{activeConsents.has(p) ? "Granted" : "Not granted"}</Badge></li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Only the graduate can change consent, from their personal page.</p>
          </Card>
          {can(role, "graduate:rotate_link") && <Card title="Personal link"><RotateLink id={g.id} /></Card>}
          {can(role, "audit:read") && (
            <Card title="Audit trail">
              <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
                {g.auditTrail.map((a) => <li key={a.id}><span className="font-medium">{a.action}</span> · {a.actorLabel} · {fmtDateTime(a.at)}</li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
