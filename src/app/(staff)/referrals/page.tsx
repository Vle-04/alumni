import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { listReferrals, referralMetricsView } from "@/server/services/placement";
import { enumLabel } from "@/i18n";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { ReferralBoard, type BoardCard } from "./ReferralBoard";

export const metadata = { title: "Referrals" };
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireStaffPage("referral:read");
  const view = (await searchParams).view === "table" ? "table" : "board";
  const [{ rows }, m] = await Promise.all([listReferrals(ctx, { status: "all" }), referralMetricsView(ctx)]);
  const now = Date.now();
  const cards: BoardCard[] = rows.map((r) => ({
    id: r.id, status: r.status, allowed: r.allowed, daysInStage: Math.floor((now - r.statusChangedAt.getTime()) / 86_400_000),
    graduate: { id: r.graduate.id, fullName: r.graduate.fullName }, opening: { id: r.opening.id, title: r.opening.title, company: r.opening.company.canonicalName },
  }));
  return (
    <>
      <PageHeader title="Referrals" description="Drag a card, or use its “Move to” menu. Every change is time-stamped and audited."
        actions={<nav aria-label="View" className="flex gap-2">
          <Link href="/referrals" aria-current={view === "board" ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${view === "board" ? "border-accent font-semibold" : "border-border"}`}>Board</Link>
          <Link href="/referrals?view=table" aria-current={view === "table" ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${view === "table" ? "border-accent font-semibold" : "border-border"}`}>Table</Link>
        </nav>} />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card title="Stage conversion">
          <Table caption="Conversion rate per stage">
            <thead><tr><Th>From → to</Th><Th>Rate</Th></tr></thead>
            <tbody>{m.conversions.map((c) => <tr key={c.from}><Td className="text-xs">{enumLabel("referral", c.from)} → {enumLabel("referral", c.to)}<span className="text-muted"> ({c.reachedTo}/{c.reachedFrom})</span></Td><Td className="font-semibold">{pct(c.rate)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="Hires per company">
          <p className="mb-2 text-sm">Median days from referral to hire: <strong>{m.medianDaysReferralToHire === null ? "—" : Math.round(m.medianDaysReferralToHire)}</strong> ({m.hires} hires)</p>
          <ul className="space-y-1 text-sm">{m.hiresByCompany.map((h) => <li key={h.companyId} className="flex justify-between"><span>{h.companyName} {h.isPartner && <Badge tone="accent">Partner</Badge>}</span><strong>{h.hires}</strong></li>)}</ul>
        </Card>
        <Card title="Referrals per opening">
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">{m.perOpening.map((o) => <li key={o.id} className="flex justify-between gap-2"><Link className="truncate underline" href={`/openings/${o.id}`}>{o.title}</Link><strong>{o.n}</strong></li>)}</ul>
        </Card>
      </div>

      {view === "board" ? <ReferralBoard cards={cards} /> : (
        <Table caption="All referrals">
          <thead><tr><Th>Graduate</Th><Th>Opening</Th><Th>Status</Th><Th>In stage since</Th><Th>Referred by</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <Td><Link className="text-accent underline" href={`/graduates/${r.graduate.id}`}>{r.graduate.fullName}</Link></Td>
              <Td><Link className="underline" href={`/openings/${r.opening.id}`}>{r.opening.title}</Link> · {r.opening.company.canonicalName}</Td>
              <Td><Badge>{enumLabel("referral", r.status)}</Badge></Td><Td>{fmtDate(r.statusChangedAt)}</Td><Td>{r.referredBy.name ?? "—"}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}
