import { requireStaffPage } from "@/server/session";
import { listSkills } from "@/server/services/skills-admin";
import { Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { AddSynonym, MergeSkills } from "./SkillForms";
import { removeSynonymAction } from "./actions";

export const metadata = { title: "Skills & synonyms" };

export default async function SkillsPage() {
  const ctx = await requireStaffPage("skills:manage");
  const skills = await listSkills(ctx);
  return (
    <>
      <PageHeader title="Skills & synonyms" description="Synonyms make “JS” and “JavaScript”, or “Postgres” and “PostgreSQL”, count as the same skill in matching, imports and forms." />
      <Card title="Merge duplicate skills" className="mb-6"><MergeSkills skills={skills.map((s) => ({ id: s.id, name: `${s.canonicalName} (${s._count.graduates} grads, ${s._count.openings} openings)` }))} /></Card>
      <Table caption="Skills and their synonyms">
        <thead><tr><Th>Skill</Th><Th>Synonyms</Th><Th>Graduates</Th><Th>Openings</Th></tr></thead>
        <tbody>{skills.map((s) => (
          <tr key={s.id}>
            <Td className="font-medium">{s.canonicalName}</Td>
            <Td>
              <ul className="mb-1 flex flex-wrap gap-1">{s.synonyms.map((syn) => (
                <li key={syn.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 text-xs">{syn.alias}
                  <form action={removeSynonymAction.bind(null, syn.id)}><button type="submit" aria-label={`Remove synonym ${syn.alias}`} className="text-muted hover:text-danger">×</button></form></li>
              ))}</ul>
              <AddSynonym skillId={s.id} name={s.canonicalName} />
            </Td>
            <Td>{s._count.graduates}</Td><Td>{s._count.openings}</Td>
          </tr>
        ))}</tbody>
      </Table>
    </>
  );
}
