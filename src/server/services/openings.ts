import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { REMOTE_MODES, ROLE_CATEGORIES, SALARY_BANDS } from "@/domain/enums";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ForbiddenError, NotFoundError, RateLimitError } from "../errors";
import { checkRateLimit } from "../rate-limit";
import { loadSkillDictionary, resolveOrCreateSkill } from "./skills";

const optText = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v ?? undefined), z.string().max(max).optional());

export const openingInputSchema = z.object({
  companyId: z.string().min(1, "Choose a company"),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10, "Add a short description").max(5000),
  roleCategory: z.preprocess((v) => v || undefined, z.enum(ROLE_CATEGORIES).optional()),
  city: optText(100),
  country: optText(100),
  remoteMode: z.enum(REMOTE_MODES),
  seniority: z.enum(["intern", "junior", "mid", "senior"]),
  salaryBand: z.preprocess((v) => v || undefined, z.enum(SALARY_BANDS).optional()),
  deadline: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
  skills: z.array(z.object({ name: z.string().trim().min(1).max(60), weight: z.coerce.number().int().min(1).max(5), mustHave: z.boolean() })).max(20),
});
export type OpeningInput = z.infer<typeof openingInputSchema>;

export async function setOpeningSkills(db: Db, openingId: string, skills: OpeningInput["skills"]) {
  const dict = await loadSkillDictionary(db);
  const byId = new Map<string, { weight: number; mustHave: boolean }>();
  for (const s of skills) {
    const id = await resolveOrCreateSkill(db, dict, s.name);
    const prev = byId.get(id);
    byId.set(id, { weight: Math.max(prev?.weight ?? 0, s.weight), mustHave: (prev?.mustHave ?? false) || s.mustHave });
  }
  await db.openingSkill.deleteMany({ where: { openingId } });
  if (byId.size) await db.openingSkill.createMany({ data: [...byId].map(([skillId, v]) => ({ openingId, skillId, ...v })) });
}

function data(i: OpeningInput) {
  return {
    companyId: i.companyId, title: i.title, description: i.description, roleCategory: i.roleCategory ?? null, city: i.city ?? null,
    country: i.country ?? null, remoteMode: i.remoteMode, seniority: i.seniority, salaryBand: i.salaryBand ?? null, deadline: i.deadline ?? null,
  };
}

export const openingFiltersSchema = z.object({
  status: z.enum(["open", "pending_moderation", "paused", "closed", "rejected", "all"]).default("open").catch("open"),
  companyId: optText(40),
});

export async function listOpenings(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "opening:read");
  const f = openingFiltersSchema.parse(raw ?? {});
  const where: Prisma.OpeningWhereInput = { ...(f.status === "all" ? {} : { status: f.status }), ...(f.companyId ? { companyId: f.companyId } : {}) };
  const rows = await prisma.opening.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: { company: true, skills: { include: { skill: true } }, _count: { select: { referrals: true, notifications: true } } },
  });
  const pending = await prisma.opening.count({ where: { status: "pending_moderation" } });
  return { filters: f, rows, pending };
}

export async function getOpening(ctx: RequestContext, id: string) {
  requirePermission(ctx, "opening:read");
  const o = await prisma.opening.findUnique({
    where: { id },
    include: { company: true, submittedBy: { select: { name: true } }, skills: { include: { skill: true }, orderBy: [{ mustHave: "desc" }, { weight: "desc" }] } },
  });
  if (!o) throw new NotFoundError("Opening");
  return o;
}

export async function createOpening(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "opening:write");
  const input = openingInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const o = await tx.opening.create({ data: { ...data(input), status: "open", source: "staff", createdById: ctx.actor.id } });
    await setOpeningSkills(tx, o.id, input.skills);
    await audit(tx, ctx, { action: "opening.create", entityType: "Opening", entityId: o.id, after: { title: o.title, companyId: o.companyId } });
    return o.id;
  });
}

export async function updateOpening(ctx: RequestContext, id: string, raw: unknown) {
  requirePermission(ctx, "opening:write");
  const input = openingInputSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const before = await tx.opening.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Opening");
    const after = await tx.opening.update({ where: { id }, data: data(input) });
    await setOpeningSkills(tx, id, input.skills);
    await audit(tx, ctx, { action: "opening.update", entityType: "Opening", entityId: id, before, after });
  });
}

const STATUS_ACTIONS = { approve: "open", reject: "rejected", pause: "paused", reopen: "open", close: "closed" } as const;

/** Moderation (approve/reject partner submissions) and lifecycle changes. */
export async function setOpeningStatus(ctx: RequestContext, id: string, rawAction: unknown) {
  requirePermission(ctx, "opening:write");
  // Validated: server actions can be called with arbitrary arguments ("constructor" etc.).
  const action = z.enum(["approve", "reject", "pause", "reopen", "close"]).parse(rawAction);
  const status = STATUS_ACTIONS[action];
  const before = await prisma.opening.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Opening");
  await prisma.opening.update({ where: { id }, data: { status } });
  await audit(prisma, ctx, { action: `opening.${action}`, entityType: "Opening", entityId: id, before: { status: before.status }, after: { status } });
}

/** Partner submission from the tokenized portal → moderation queue. */
export async function submitOpeningAsPartner(ctx: RequestContext, raw: unknown) {
  if (ctx.actor.type !== "partner") throw new ForbiddenError();
  if (!(await checkRateLimit(`partner-submit:${ctx.actor.id}`, 10, 3600))) throw new RateLimitError(3600);
  const companyId = ctx.actor.companyId;
  const input = openingInputSchema.parse({ ...(raw as object), companyId });
  return prisma.$transaction(async (tx) => {
    const o = await tx.opening.create({ data: { ...data(input), companyId, status: "pending_moderation", source: "partner_form", submittedByPartnerId: ctx.actor.id } });
    await setOpeningSkills(tx, o.id, input.skills);
    await audit(tx, ctx, { action: "opening.submit", entityType: "Opening", entityId: o.id, after: { title: o.title } });
    return o.id;
  });
}
