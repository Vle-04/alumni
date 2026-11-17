import type { Metadata } from "next";
import { getPartnerContext } from "@/server/partner-session";
import { partnerDashboard } from "@/server/services/partner";
import { enumLabel } from "@/i18n";
import { Alert, Badge, Card, EmptyState, Table, Td, Th } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { OpeningForm } from "../../(staff)/openings/OpeningForm";
import { submitOpeningAction } from "./actions";

export const metadata: Metadata = { title: "Partner portal" };

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const ctx = await getPartnerContext();
  if (!ctx) {
    const { expired } = await searchParams;
    return (
      <>
        <h1 className="text-2xl font-semibold">{expired === "revoked" ? "This link is no longer valid" : "Please use your portal link"}</h1>
        <p className="mt-2 text-muted">Partner portal links are personal and expire after 90 days. Ask your contact in the Academy careers team for a new one.</p>
      </>
    );
  }
  const d = await partnerDashboard(ctx);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{ctx.companyName}</h1>
        <p className="text-muted">Signed in as {ctx.contactName}</p>
      </div>
      <Card title="Candidates referred to you">
        <p className="mb-3 text-sm text-muted">You see a candidate&rsquo;s details only when they said they&rsquo;re interested in the role and agreed to share their profile with partner companies. They can withdraw that at any time.</p>
        {d.referrals.length === 0 ? <EmptyState>No referrals yet.</EmptyState> : (
          <Table caption="Referrals to your company">
            <thead><tr><Th>Candidate</Th><Th>Opening</Th><Th>Status</Th><Th>Since</Th></tr></thead>
            <tbody>{d.referrals.map((r) => (
              <tr key={r.id}>
                <Td>{r.candidate.shared ? (
                  <div><p className="font-medium">{r.candidate.name}</p><p className="text-sm">{r.candidate.email}</p>
                    {r.candidate.linkedinUrl && <p className="text-xs break-all text-muted">{r.candidate.linkedinUrl}</p>}
                    <p className="text-xs text-muted">{r.candidate.skills.join(", ")}</p></div>
                ) : <span className="text-sm text-muted">Details not shared</span>}</Td>
                <Td>{r.openingTitle}</Td><Td><Badge>{enumLabel("referral", r.status)}</Badge></Td><Td>{fmtDate(r.statusChangedAt)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Card title="Your openings">
        <ul className="space-y-1 text-sm">{d.openings.map((o) => <li key={o.id} className="flex justify-between"><span>{o.title}</span><Badge>{o.status === "pending_moderation" ? "awaiting review" : o.status}</Badge></li>)}</ul>
      </Card>
      <Card title="Submit a new opening">
        <Alert>New openings are reviewed by the Academy before graduates see them.</Alert>
        <div className="mt-4"><OpeningForm action={submitOpeningAction} submitLabel="Submit for review" /></div>
      </Card>
    </div>
  );
}
