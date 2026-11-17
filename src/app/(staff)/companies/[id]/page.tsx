import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/session";
import { prisma } from "@/server/db";
import { listPartnerContacts } from "@/server/services/partner";
import { can } from "@/domain/rbac/permissions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { AddContact, CompanyForm, PortalLink } from "./CompanyForms";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("company:read");
  const { id } = await params;
  const c = await prisma.company.findUnique({ where: { id }, include: { aliases: true, openings: { orderBy: { createdAt: "desc" }, take: 20 }, _count: { select: { records: true } } } });
  if (!c) notFound();
  const contacts = await listPartnerContacts(ctx, id);
  const canWrite = can(ctx.actor.role, "company:write");
  return (
    <>
      <PageHeader title={c.canonicalName} description={<>{c.isPartner && <Badge tone="accent">Partner</Badge>} {c._count.records} employment records · also known as: {c.aliases.map((a) => a.alias).join(", ")}</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {canWrite && <Card title="Company"><CompanyForm c={c} /></Card>}
        <Card title="Openings">
          <ul className="space-y-1 text-sm">{c.openings.map((o) => <li key={o.id}><Link className="text-accent underline" href={`/openings/${o.id}`}>{o.title}</Link> <Badge>{o.status.replace("_", " ")}</Badge></li>)}</ul>
        </Card>
        {c.isPartner && (
          <Card title="Partner portal contacts" className="lg:col-span-2">
            <p className="mb-3 text-sm text-muted">Contacts use a personal link (no account) to submit openings and follow referrals. They see a graduate&rsquo;s details only after the graduate clicked Interested and agreed to sharing.</p>
            <ul className="mb-4 divide-y divide-border">{contacts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div><p className="font-medium">{p.name}</p><p className="text-sm text-muted">{p.email}</p></div>
                {canWrite && <PortalLink contactId={p.id} />}
              </li>
            ))}</ul>
            {canWrite && <AddContact companyId={c.id} />}
          </Card>
        )}
      </div>
    </>
  );
}
