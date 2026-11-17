import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { listCompanies, listMergeSuggestions } from "@/server/services/companies";
import { can } from "@/domain/rbac/permissions";
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { acceptMergeAction, rejectMergeAction } from "./actions";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const ctx = await requireStaffPage("company:read");
  const [suggestions, companies] = await Promise.all([listMergeSuggestions(ctx), listCompanies(ctx)]);
  const canWrite = can(ctx.actor.role, "company:write");
  return (
    <>
      <PageHeader title="Companies" description="Names are matched automatically when they differ only by case, punctuation or legal form. Similar names wait here for a decision." />
      <Card title={`Possible duplicates (${suggestions.length})`} className="mb-6">
        {suggestions.length === 0 ? <EmptyState>No merge suggestions right now.</EmptyState> : (
          <ul className="divide-y divide-border">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="text-sm">
                  Merge <strong>{s.source.canonicalName}</strong> ({s.source._count.records} records) into <strong>{s.target.canonicalName}</strong> ({s.target._count.records} records)?
                  <span className="ml-2 text-muted">similarity {Math.round(s.similarity * 100)}%</span>
                </p>
                {canWrite && (
                  <div className="flex gap-2">
                    <form action={acceptMergeAction.bind(null, s.id)}><Button type="submit">Merge</Button></form>
                    <form action={rejectMergeAction.bind(null, s.id)}><Button type="submit" variant="secondary">Keep separate</Button></form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Table caption="All companies">
        <thead><tr><Th>Company</Th><Th>Industry</Th><Th>Partner</Th><Th>Employment records</Th><Th>Openings</Th></tr></thead>
        <tbody>{companies.map((c) => (
          <tr key={c.id}><Td className="font-medium"><Link className="text-accent underline" href={`/companies/${c.id}`}>{c.canonicalName}</Link></Td><Td>{c.industry ?? "—"}</Td><Td>{c.isPartner ? <Badge tone="accent">Partner</Badge> : "—"}</Td><Td>{c._count.records}</Td><Td>{c._count.openings}</Td></tr>
        ))}</tbody>
      </Table>
    </>
  );
}
