import { z } from "zod";
import { findSimilarCompanies, normalizeCompanyName } from "@/domain/companies/normalize";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError } from "../errors";

export const MERGE_SUGGESTION_THRESHOLD = 0.82;

/**
 * Finds the company for a typed name, or creates it. Names that differ only by case,
 * punctuation or legal form ("Google" / "Google LLC") resolve to the same company.
 * Anything merely *similar* creates a merge suggestion that staff must confirm.
 */
export async function resolveCompany(db: Db, rawName: string): Promise<string> {
  const name = rawName.trim().replace(/\s+/g, " ");
  const key = normalizeCompanyName(name);
  if (!key) throw new ConflictError("Company name is empty");
  const alias = await db.companyAlias.findUnique({ where: { alias: key } });
  if (alias) return alias.companyId;

  const existing = await db.company.findMany({ select: { id: true, canonicalName: true, aliases: { select: { alias: true } } } });
  const company = await db.company.create({ data: { canonicalName: await uniqueCanonical(db, name), aliases: { create: { alias: key } } } });
  const matches = findSimilarCompanies(
    name,
    existing.map((c) => ({ id: c.id, names: [c.canonicalName, ...c.aliases.map((a) => a.alias)] })),
    MERGE_SUGGESTION_THRESHOLD,
  );
  for (const m of matches) {
    await db.companyMergeSuggestion.upsert({
      where: { sourceCompanyId_targetCompanyId: { sourceCompanyId: company.id, targetCompanyId: m.id } },
      create: { sourceCompanyId: company.id, targetCompanyId: m.id, similarity: m.similarity },
      update: {},
    });
  }
  return company.id;
}

async function uniqueCanonical(db: Db, name: string): Promise<string> {
  let candidate = name;
  for (let i = 2; await db.company.findUnique({ where: { canonicalName: candidate } }); i++) candidate = `${name} (${i})`;
  return candidate;
}

export async function listCompanies(ctx: RequestContext, opts: { q?: string } = {}) {
  requirePermission(ctx, "company:read");
  return prisma.company.findMany({
    where: opts.q ? { canonicalName: { contains: opts.q, mode: "insensitive" } } : undefined,
    orderBy: { canonicalName: "asc" },
    include: { _count: { select: { records: true, openings: true } }, aliases: true },
    take: 500,
  });
}

export async function listMergeSuggestions(ctx: RequestContext) {
  requirePermission(ctx, "company:read");
  return prisma.companyMergeSuggestion.findMany({
    where: { status: "pending" },
    orderBy: { similarity: "desc" },
    include: {
      source: { include: { _count: { select: { records: true, openings: true } } } },
      target: { include: { _count: { select: { records: true, openings: true } } } },
    },
  });
}

/** Merges the suggestion's source company INTO its target. Irreversible; audited. */
export async function acceptMerge(ctx: RequestContext, suggestionId: string) {
  requirePermission(ctx, "company:write");
  return prisma.$transaction(async (tx) => {
    const s = await tx.companyMergeSuggestion.findUnique({ where: { id: suggestionId }, include: { source: true, target: true } });
    if (!s || s.status !== "pending") throw new NotFoundError("Merge suggestion");
    const { source, target } = s;
    await tx.employmentRecord.updateMany({ where: { companyId: source.id }, data: { companyId: target.id } });
    await tx.opening.updateMany({ where: { companyId: source.id }, data: { companyId: target.id } });
    await tx.partnerContact.updateMany({ where: { companyId: source.id }, data: { companyId: target.id } });
    await tx.companyAlias.updateMany({ where: { companyId: source.id }, data: { companyId: target.id } });
    const extraKey = normalizeCompanyName(source.canonicalName);
    await tx.companyAlias.upsert({ where: { alias: extraKey }, create: { alias: extraKey, companyId: target.id }, update: { companyId: target.id } });
    await tx.company.update({
      where: { id: target.id },
      data: { isPartner: target.isPartner || source.isPartner, industry: target.industry ?? source.industry, website: target.website ?? source.website },
    });
    // Re-point other pending suggestions that referenced the source.
    await tx.companyMergeSuggestion.deleteMany({ where: { OR: [{ sourceCompanyId: source.id }, { targetCompanyId: source.id }], NOT: { id: s.id } } });
    await tx.companyMergeSuggestion.update({ where: { id: s.id }, data: { status: "accepted", decidedAt: new Date(), decidedById: ctx.actor.id } });
    await audit(tx, ctx, { action: "company.merge", entityType: "Company", entityId: target.id, meta: { mergedCompanyId: source.id, mergedName: source.canonicalName } });
    await tx.company.delete({ where: { id: source.id } });
    return target.id;
  });
}

export async function rejectMerge(ctx: RequestContext, suggestionId: string) {
  requirePermission(ctx, "company:write");
  await prisma.companyMergeSuggestion.update({ where: { id: suggestionId }, data: { status: "rejected", decidedAt: new Date(), decidedById: ctx.actor.id } });
  await audit(prisma, ctx, { action: "company.merge_rejected", entityType: "CompanyMergeSuggestion", entityId: suggestionId });
}

export const companyUpdateSchema = z.object({
  canonicalName: z.string().trim().min(1).max(150),
  industry: z.string().trim().max(100).optional().transform((v) => v || null),
  isPartner: z.boolean(),
  website: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).optional().transform((v) => v || null),
});

export async function updateCompany(ctx: RequestContext, id: string, input: unknown) {
  requirePermission(ctx, "company:write");
  const data = companyUpdateSchema.parse(input);
  const before = await prisma.company.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Company");
  const after = await prisma.company.update({ where: { id }, data });
  const key = normalizeCompanyName(data.canonicalName);
  await prisma.companyAlias.upsert({ where: { alias: key }, create: { alias: key, companyId: id }, update: {} });
  await audit(prisma, ctx, { action: "company.update", entityType: "Company", entityId: id, before, after });
}
