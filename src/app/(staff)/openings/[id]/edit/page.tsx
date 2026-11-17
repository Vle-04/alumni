import { requireStaffPage } from "@/server/session";
import { prisma } from "@/server/db";
import { getOpening } from "@/server/services/openings";
import { Card, PageHeader } from "@/components/ui";
import { OpeningForm } from "../../OpeningForm";
import { updateOpeningAction } from "../../actions";

export default async function EditOpening({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("opening:write");
  const { id } = await params;
  const o = await getOpening(ctx, id);
  const companies = (await prisma.company.findMany({ orderBy: { canonicalName: "asc" } })).map((c) => ({ id: c.id, name: c.canonicalName }));
  return (
    <><PageHeader title={`Edit ${o.title}`} />
      <Card><OpeningForm action={updateOpeningAction.bind(null, id)} companies={companies} submitLabel="Save opening"
        initial={{ ...o, skills: o.skills.map((s) => ({ name: s.skill.canonicalName, weight: s.weight, mustHave: s.mustHave })) }} /></Card></>
  );
}
