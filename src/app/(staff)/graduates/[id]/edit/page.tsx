import { requireStaffPage } from "@/server/session";
import { listCohorts } from "@/server/services/cohorts";
import { getGraduateForEdit } from "@/server/services/graduates";
import { PageHeader } from "@/components/ui";
import { GraduateForm } from "../../GraduateForm";
import { updateGraduateAction } from "../../actions";
import { formOptions } from "../../form-options";

export const metadata = { title: "Edit graduate" };

export default async function EditGraduate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaffPage("graduate:write");
  const [initial, cohorts] = await Promise.all([getGraduateForEdit(ctx, id), listCohorts(ctx)]);
  return (
    <>
      <PageHeader title={`Edit ${initial.fullName}`} description="Opening this form decrypts contact details and is recorded in the audit log." />
      <GraduateForm action={updateGraduateAction.bind(null, id)} initial={initial} cohorts={cohorts.map((c) => ({ value: c.id, label: c.name }))} {...formOptions} submitLabel="Save changes" />
    </>
  );
}
