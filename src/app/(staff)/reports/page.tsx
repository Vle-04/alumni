import { requireStaffPage } from "@/server/session";
import { PageHeader, Card } from "@/components/ui";

export const metadata = { title: "Outcomes report" };

export default async function Reports() {
  await requireStaffPage("report:read");
  return (
    <>
      <PageHeader title="Outcomes report" />
      <Card><p className="text-sm text-muted">The outcomes report is built in phase 4.</p></Card>
    </>
  );
}
