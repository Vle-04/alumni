import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { listOpenings } from "@/server/services/openings";
import { can } from "@/domain/rbac/permissions";
import { enumLabel } from "@/i18n";
import { Badge, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { STATUS_TONE } from "./status-tone";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Openings" };
const TABS = [["open", "Open"], ["pending_moderation", "Awaiting review"], ["paused", "Paused"], ["closed", "Closed"], ["all", "All"]] as const;

export default async function OpeningsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireStaffPage("opening:read");
  const { rows, filters, pending } = await listOpenings(ctx, await searchParams);
  return (
    <>
      <PageHeader title="Openings" description="Partner job openings, matched to graduates who are searching."
        actions={can(ctx.actor.role, "opening:write") && <LinkButton href="/openings/new" variant="primary">New opening</LinkButton>} />
      <nav aria-label="Opening status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([v, label]) => (
          <Link key={v} href={`/openings?status=${v}`} aria-current={filters.status === v ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${filters.status === v ? "border-accent bg-accent/10 font-semibold text-accent" : "border-border"}`}>
            {label}{v === "pending_moderation" && pending > 0 && <span className="ml-1 rounded-full bg-warning px-1.5 text-xs text-white">{pending}</span>}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState>No openings here.</EmptyState> : (
        <Table caption="Openings">
          <thead><tr><Th>Opening</Th><Th>Company</Th><Th>Where</Th><Th>Skills</Th><Th>Status</Th><Th>Notified</Th><Th>Referrals</Th><Th>Deadline</Th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <Td><Link className="font-medium text-accent underline" href={`/openings/${o.id}`}>{o.title}</Link>{o.source === "partner_form" && <p className="text-xs text-muted">Submitted by partner</p>}</Td>
              <Td>{o.company.canonicalName}{o.company.isPartner && <Badge tone="accent" className="ml-1">Partner</Badge>}</Td>
              <Td>{enumLabel("remoteMode", o.remoteMode)}{o.city && ` · ${o.city}`}</Td>
              <Td className="text-xs">{o.skills.map((s) => s.skill.canonicalName + (s.mustHave ? "*" : "")).join(", ")}</Td>
              <Td><Badge tone={STATUS_TONE[o.status]}>{o.status.replace("_", " ")}</Badge></Td>
              <Td>{o._count.notifications}</Td><Td>{o._count.referrals}</Td><Td>{fmtDate(o.deadline)}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-muted">* must-have skill</p>
    </>
  );
}
