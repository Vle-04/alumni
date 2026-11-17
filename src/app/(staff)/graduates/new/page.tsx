import { requireStaffPage } from "@/server/session";
import { listCohorts } from "@/server/services/cohorts";
import { PageHeader } from "@/components/ui";
import { GraduateForm } from "../GraduateForm";
import { createGraduateAction } from "../actions";
import { formOptions } from "../form-options";

export const metadata = { title: "Add graduate" };

export default async function NewGraduate() {
  const ctx = await requireStaffPage("graduate:write");
  const cohorts = (await listCohorts(ctx)).map((c) => ({ value: c.id, label: c.name }));
  return (
    <>
      <PageHeader title="Add graduate" description="Graduates update their own status later through their personal link." />
      <GraduateForm action={createGraduateAction} cohorts={cohorts} {...formOptions} submitLabel="Create graduate" />
    </>
  );
}
