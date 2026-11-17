import { buildSkillDictionary, resolveSkill, skillKey, type SkillDictionary } from "@/domain/skills/normalize";
import type { Db } from "../db";

export async function loadSkillDictionary(db: Db): Promise<SkillDictionary> {
  const [skills, synonyms] = await Promise.all([
    db.skill.findMany({ select: { id: true, canonicalName: true } }),
    db.skillSynonym.findMany({ select: { skillId: true, alias: true } }),
  ]);
  return buildSkillDictionary(skills, synonyms);
}

/** Resolves a free-text skill to a canonical id, creating a new canonical skill if unknown. */
export async function resolveOrCreateSkill(db: Db, dict: SkillDictionary, name: string): Promise<string> {
  const found = resolveSkill(dict, name);
  if (found) return found;
  const created = await db.skill.upsert({
    where: { canonicalName: name.trim() },
    create: { canonicalName: name.trim() },
    update: {},
  });
  (dict.byKey as Map<string, string>).set(skillKey(name), created.id);
  return created.id;
}

export async function setGraduateSkills(db: Db, graduateId: string, skills: { name: string; level: number }[]) {
  const dict = await loadSkillDictionary(db);
  const resolved = new Map<string, number>();
  for (const s of skills) resolved.set(await resolveOrCreateSkill(db, dict, s.name), s.level);
  await db.graduateSkill.deleteMany({ where: { graduateId } });
  if (resolved.size) {
    await db.graduateSkill.createMany({ data: [...resolved].map(([skillId, level]) => ({ graduateId, skillId, level })) });
  }
}
