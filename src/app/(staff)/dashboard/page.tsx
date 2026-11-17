import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { needsAttention, LONG_SEARCH_DAYS, STUCK_REFERRAL_DAYS, NEW_OPENING_DAYS } from "@/server/services/dashboard";
import { STALE_AFTER_DAYS } from "@/domain/records/staleness";
import { enumLabel } from "@/i18n";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Dashboard" };
const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

function Queue({ title, count, help, href, children }: { title: string; count: number; help: string; href?: string; children?: React.ReactNode }) {
  return (
    <Card title={<span className="flex items-center gap-2">{title}<Badge tone={count > 0 ? "warning" : "success"}>{count}</Badge></span>}
      actions={href && <Link href={href} className="text-sm text-accent underline">Open</Link>}>
      <p className="mb-2 text-xs text-muted">{help}</p>
      {count === 0 ? <p className="text-sm text-success">Nothing here.</p> : children}
    </Card>
  );
}

export default async function Dashboard() {
  const ctx = await requireStaffPage("dashboard:read");
  const q = await needsAttention(ctx);
  const total = q.longSearchingNoReferral.length + q.bouncedSurveys.length + q.stuckReferrals.length + q.newOpeningsWithoutMatches.length + (q.failedEmails > 0 ? 1 : 0);
  return (
    <>
      <PageHeader title="Needs attention" description={total === 0 ? "All clear." : "Work through these to keep records current and help graduates who are still searching."} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Queue title="Searching long, no referral" count={q.longSearchingNoReferral.length} help={`Searching for more than ${LONG_SEARCH_DAYS} days with no referral in this search.`} href="/graduates?status=searching&sort=updated_asc">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">{q.longSearchingNoReferral.slice(0, 30).map((g) => (
            <li key={g.id} className="flex justify-between gap-2 py-1.5"><Link className="text-accent underline" href={`/graduates/${g.id}`}>{g.fullName}</Link><span className="text-muted">{g.cohort.name} · {days(g.searchingSince!)} days</span></li>
          ))}</ul>
        </Queue>
        <Queue title="Referrals stuck in one stage" count={q.stuckReferrals.length} help={`No movement for more than ${STUCK_REFERRAL_DAYS} days.`} href="/referrals">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">{q.stuckReferrals.slice(0, 30).map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span><Link className="text-accent underline" href={`/graduates/${r.graduate.id}`}>{r.graduate.fullName}</Link> · {r.opening.title}</span>
              <span className="text-muted"><Badge>{enumLabel("referral", r.status)}</Badge> {days(r.statusChangedAt)} days</span></li>
          ))}</ul>
        </Queue>
        <Queue title="Bounced surveys" count={q.bouncedSurveys.length} help="The survey email couldn't be delivered — the email address is probably wrong." href="/surveys">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">{q.bouncedSurveys.map((s) => (
            <li key={s.id} className="flex justify-between gap-2 py-1.5"><Link className="text-accent underline" href={`/graduates/${s.graduate.id}`}>{s.graduate.fullName}</Link><span className="text-muted">{s.milestone}-month · {fmtDate(s.scheduledFor)}</span></li>
          ))}</ul>
        </Queue>
        <Queue title="New openings with no matches" count={q.newOpeningsWithoutMatches.length} help={`Open openings from the last ${NEW_OPENING_DAYS} days that no searching graduate fits (${q.allOpeningsWithoutMatches} open openings in total have none).`} href="/openings">
          <ul className="divide-y divide-border text-sm">{q.newOpeningsWithoutMatches.map((o) => (
            <li key={o.id} className="flex justify-between gap-2 py-1.5"><Link className="text-accent underline" href={`/openings/${o.id}`}>{o.title}</Link><span className="text-muted">{o.companyName}</span></li>
          ))}</ul>
        </Queue>
        <Queue title="Stale records" count={q.staleCount} help={`No update in more than ${STALE_AFTER_DAYS} days.`} href="/graduates?stale=1" />
        <Queue title="Failed emails" count={q.failedEmails} help="Emails that failed permanently or whose delivery is uncertain." href="/surveys" />
      </div>
    </>
  );
}
