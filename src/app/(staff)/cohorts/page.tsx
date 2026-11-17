import Link from "next/link";
import { requireStaffPage } from "@/server/session";
import { listCohorts, listPrograms } from "@/server/services/cohorts";
import { Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { CohortForm, ProgramForm } from "./CohortForm";
import { createCohortAction, createProgramAction } from "./actions";

export const metadata = { title: "Cohorts" };

export default async function CohortsPage() {
  const ctx = await requireStaffPage("cohort:write");
  const [cohorts, programs] = await Promise.all([listCohorts(ctx), listPrograms()]);
  return (
    <>
      <PageHeader title="Cohorts" description="Programs, cohorts and graduation dates." />
      <Table caption="Cohorts" className="mb-6">
        <thead><tr><Th>Cohort</Th><Th>Program</Th><Th>Start</Th><Th>Graduation</Th><Th>Graduates</Th></tr></thead>
        <tbody>{cohorts.map((c) => (
          <tr key={c.id}><Td><Link className="text-accent underline" href={`/cohorts/${c.id}`}>{c.name}</Link></Td><Td>{c.program.name}</Td><Td>{fmtDate(c.startDate)}</Td><Td>{c.graduationDate ? fmtDate(c.graduationDate) : <span className="text-muted">Not set</span>}</Td><Td>{c._count.graduates}</Td></tr>
        ))}</tbody>
      </Table>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New cohort"><CohortForm action={createCohortAction} programs={programs} submitLabel="Create cohort" /></Card>
        <Card title="Programs">
          <ul className="mb-3 list-disc pl-5 text-sm">{programs.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
          <ProgramForm action={createProgramAction} />
        </Card>
      </div>
    </>
  );
}
