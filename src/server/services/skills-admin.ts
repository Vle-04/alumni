/** Admin-editable skill synonym table ("JS" = "JavaScript"). Used by matching, imports and forms. */
import { z } from "zod";
import { skillKey } from "@/domain/skills/normalize";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";

export async function listSkills(ctx: RequestContext) {
  requirePermission(ctx, "skills:manage");
  return prisma.skill.findMany({ orderBy: { canonicalName: "asc" }, include: { synonyms: { orderBy: { alias: "asc" } }, _count: { select: { graduates: true, openings: true } } } });
}

async function assertKeyFree(key: string, exceptSkillId?: string) {
  const [skill, syn] = await Promise.all([
    prisma.skill.findFirst({ where: { canonicalName: { equals: key, mode: "insensitive" } } }),
    prisma.skillSynonym.findUnique({ where: { alias: key } }),
  ]);
  if ((skill && skill.id !== exceptSkillId) || syn) throw new ConflictError(`"${key}" is already a skill or synonym.`);
}

export async function addSynonym(ctx: RequestContext, skillId: string, rawAlias: unknown) {
  requirePermission(ctx, "skills:manage");
  const alias = skillKey(z.string().min(1).max(60).parse(rawAlias));
  if (!alias) throw new ValidationError("Enter a synonym.");
  await assertKeyFree(alias, skillId);
  await prisma.skillSynonym.create({ data: { skillId, alias } });
  await audit(prisma, ctx, { action: "skill.add_synonym", entityType: "Skill", entityId: skillId, meta: { alias } });
}

export async function removeSynonym(ctx: RequestContext, synonymId: string) {
  requirePermission(ctx, "skills:manage");
  const s = await prisma.skillSynonym.delete({ where: { id: synonymId } }).catch(() => null);
  if (!s) throw new NotFoundError("Synonym");
  await audit(prisma, ctx, { action: "skill.remove_synonym", entityType: "Skill", entityId: s.skillId, meta: { alias: s.alias } });
}

/**
 * Turns `sourceId` into a synonym of `targetId`: graduate levels keep the higher value, opening
 * requirements keep the higher weight and must-have flag. Irreversible; audited.
 */
export async function mergeSkillInto(ctx: RequestContext, sourceId: string, targetId: string) {
  requirePermission(ctx, "skills:manage");
  if (sourceId === targetId) throw new ValidationError("Choose a different skill.");
  await prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([tx.skill.findUnique({ where: { id: sourceId }, include: { synonyms: true } }), tx.skill.findUnique({ where: { id: targetId } })]);
    if (!source || !target) throw new NotFoundError("Skill");
    for (const gs of await tx.graduateSkill.findMany({ where: { skillId: sourceId } })) {
      const existing = await tx.graduateSkill.findUnique({ where: { graduateId_skillId: { graduateId: gs.graduateId, skillId: targetId } } });
      if (existing) await tx.graduateSkill.update({ where: { graduateId_skillId: { graduateId: gs.graduateId, skillId: targetId } }, data: { level: Math.max(existing.level, gs.level) } });
      else await tx.graduateSkill.create({ data: { graduateId: gs.graduateId, skillId: targetId, level: gs.level } });
    }
    for (const os of await tx.openingSkill.findMany({ where: { skillId: sourceId } })) {
      const existing = await tx.openingSkill.findUnique({ where: { openingId_skillId: { openingId: os.openingId, skillId: targetId } } });
      if (existing) await tx.openingSkill.update({ where: { openingId_skillId: { openingId: os.openingId, skillId: targetId } }, data: { weight: Math.max(existing.weight, os.weight), mustHave: existing.mustHave || os.mustHave } });
      else await tx.openingSkill.create({ data: { openingId: os.openingId, skillId: targetId, weight: os.weight, mustHave: os.mustHave } });
    }
    await tx.skill.delete({ where: { id: sourceId } }); // cascades its rows and synonyms
    const aliases = [skillKey(source.canonicalName), ...source.synonyms.map((s) => s.alias)];
    for (const alias of aliases) await tx.skillSynonym.upsert({ where: { alias }, create: { alias, skillId: targetId }, update: { skillId: targetId } });
    await audit(tx, ctx, { action: "skill.merge", entityType: "Skill", entityId: targetId, meta: { merged: source.canonicalName } });
  });
}
