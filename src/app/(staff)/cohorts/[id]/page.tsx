import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/session";
import { listPrograms } from "@/server/services/cohorts";
import { prisma } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { CohortForm } from "../CohortForm";
import { updateCohortAction } from "../actions";

export default async function EditCohort({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage("cohort:write");
  const { id } = await params;
  const [cohort, programs] = await Promise.all([prisma.cohort.findUnique({ where: { id } }), listPrograms()]);
  if (!cohort) notFound();
  return (
    <>
      <PageHeader title={`Edit ${cohort.name}`} />
      <Card><CohortForm action={updateCohortAction.bind(null, id)} programs={programs} initial={cohort} submitLabel="Save cohort" /></Card>
    </>
  );
}
