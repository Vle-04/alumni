import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { prisma } from "@/server/db";
import { addDays, STALE_AFTER_DAYS } from "@/domain/records/staleness";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  await requireStaffPage("dashboard:read");
  const now = new Date();
  const [total, stale, searching, suggestions] = await Promise.all([
    prisma.graduate.count({ where: { anonymizedAt: null } }),
    prisma.graduate.count({ where: { anonymizedAt: null, OR: [{ currentStatusAt: null }, { currentStatusAt: { lt: addDays(now, -STALE_AFTER_DAYS) } }] } }),
    prisma.graduate.count({ where: { anonymizedAt: null, currentStatus: "searching" } }),
    prisma.companyMergeSuggestion.count({ where: { status: "pending" } }),
  ]);
  const tiles = [
    { label: "Graduates", value: total, href: "/graduates" },
    { label: "Searching", value: searching, href: "/graduates?status=searching" },
    { label: `Stale (>${STALE_AFTER_DAYS} days)`, value: stale, href: "/graduates?stale=1" },
    { label: "Company merge suggestions", value: suggestions, href: "/companies" },
  ];
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}><Link href={t.href} className="block"><p className="text-sm text-muted">{t.label}</p><p className="mt-1 text-3xl font-semibold">{t.value}</p></Link></Card>
        ))}
      </div>
    </>
  );
}
