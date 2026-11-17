import { requireStaffPage } from "@/server/session";
import { prisma } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { OpeningForm } from "../OpeningForm";
import { createOpeningAction } from "../actions";

export const metadata = { title: "New opening" };

export default async function NewOpening() {
  await requireStaffPage("opening:write");
  const companies = (await prisma.company.findMany({ orderBy: [{ isPartner: "desc" }, { canonicalName: "asc" }] })).map((c) => ({ id: c.id, name: c.isPartner ? `${c.canonicalName} (partner)` : c.canonicalName }));
  return (<><PageHeader title="New opening" /><Card><OpeningForm action={createOpeningAction} companies={companies} submitLabel="Create opening" /></Card></>);
}
