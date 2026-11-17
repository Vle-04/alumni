import { requireStaffPage } from "@/server/session";
import { CSV_COLUMNS, REQUIRED_COLUMNS } from "@/domain/import/graduateCsv";
import { Card, PageHeader } from "@/components/ui";
import { ImportWizard } from "./ImportWizard";

export const metadata = { title: "Import graduates" };

export default async function ImportPage() {
  await requireStaffPage("graduate:import");
  return (
    <>
      <PageHeader title="Import graduates from CSV" description="Upload, check the dry-run preview, then import. Nothing is saved until you confirm." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><ImportWizard /></Card>
        <Card title="File format">
          <p className="text-sm">First row must be headers. Required: <code>{REQUIRED_COLUMNS.join(", ")}</code>.</p>
          <p className="mt-2 text-sm">Optional:</p>
          <ul className="mt-1 list-disc pl-5 text-xs">{CSV_COLUMNS.filter((c) => !(REQUIRED_COLUMNS as readonly string[]).includes(c)).map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          <p className="mt-2 text-xs text-muted">Skills: <code>JavaScript:4; React:3</code>. Dates: <code>YYYY-MM-DD</code>. Yes/no columns accept yes/no. Duplicates are detected by email. Columns for age, gender, nationality or photos are never imported.</p>
          <a className="mt-3 inline-block text-sm text-accent underline" href="/graduates-template.csv" download>Download a template</a>
        </Card>
      </div>
    </>
  );
}
