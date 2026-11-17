import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { EMPLOYMENT_STATUSES, JOB_SEARCH_STATUSES, REMOTE_PREFERENCES, ROLE_CATEGORIES } from "@/domain/enums";
import { normalizeEmail, isValidTimeZone } from "@/domain/import/graduateCsv";
import { STALE_AFTER_DAYS, addDays } from "@/domain/records/staleness";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError } from "../errors";
import { blindIndex, decryptOpt, encrypt, encryptOpt } from "../crypto";
import { setGraduateSkills } from "./skills";
import { onGraduatesCreated, onGraduateScheduleInputsChanged } from "./hooks";

const optText = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v ?? undefined), z.string().max(max).optional());
const optDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional());

export const graduateInputSchema = z.object({
  fullName: z.string().trim().min(2, "Name is too short").max(120),
  preferredName: optText(60),
  email: z.string().trim().pipe(z.email("Enter a valid email")).transform(normalizeEmail),
  phone: z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v), z.string().regex(/^\+?[0-9 ()-]{6,20}$/, "Use digits, spaces, +, ( ) or -").optional()),
  linkedinUrl: z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v), z.url({ protocol: /^https?$/, error: "Must start with http(s)://" }).max(300).optional()),
  cohortId: z.string().min(1, "Choose a cohort"),
  graduationDateOverride: optDate,
  timezone: optText(64).refine((v) => !v || isValidTimeZone(v), "Unknown time zone"),
  city: optText(100),
  country: optText(100),
  remotePreference: z.enum(REMOTE_PREFERENCES).default("any"),
  openToRelocate: z.boolean().default(false),
  jobSearchStatus: z.enum(JOB_SEARCH_STATUSES).default("active"),
  preferredRoleCategories: z.array(z.enum(ROLE_CATEGORIES)).max(5).default([]),
  skills: z.array(z.object({ name: z.string().trim().min(1).max(60), level: z.coerce.number().int().min(1).max(5) })).max(30).default([]),
});
export type GraduateInput = z.infer<typeof graduateInputSchema>;

export const graduateFiltersSchema = z.object({
  q: optText(100),
  cohortId: optText(40),
  status: z.enum(EMPLOYMENT_STATUSES).optional().catch(undefined),
  inField: z.enum(["yes", "no"]).optional().catch(undefined),
  skillId: optText(40),
  updated: z.enum(["lt30", "lt90", "gt90", "gt180", "never"]).optional().catch(undefined),
  stale: z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean()).default(false),
  sort: z.enum(["name", "updated_asc", "updated_desc"]).default("name").catch("name"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
});
export type GraduateFilters = z.infer<typeof graduateFiltersSchema>;
export const PAGE_SIZE = 25;

export function buildGraduateWhere(f: GraduateFilters, now = new Date()): Prisma.GraduateWhereInput {
  const where: Prisma.GraduateWhereInput = { anonymizedAt: null };
  const and: Prisma.GraduateWhereInput[] = [];
  if (f.q) and.push({ OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { preferredName: { contains: f.q, mode: "insensitive" } }] });
  if (f.cohortId) and.push({ cohortId: f.cohortId });
  if (f.status) and.push({ currentStatus: f.status });
  if (f.inField) and.push({ currentInField: f.inField === "yes" });
  if (f.skillId) and.push({ skills: { some: { skillId: f.skillId } } });
  const updated = f.stale ? "gt90" : f.updated;
  if (updated === "lt30") and.push({ currentStatusAt: { gte: addDays(now, -30) } });
  if (updated === "lt90") and.push({ currentStatusAt: { gte: addDays(now, -STALE_AFTER_DAYS) } });
  if (updated === "gt90") and.push({ OR: [{ currentStatusAt: { lt: addDays(now, -STALE_AFTER_DAYS) } }, { currentStatusAt: null }] });
  if (updated === "gt180") and.push({ OR: [{ currentStatusAt: { lt: addDays(now, -180) } }, { currentStatusAt: null }] });
  if (updated === "never") and.push({ currentStatusAt: null });
  if (and.length) where.AND = and;
  return where;
}

export async function listGraduates(ctx: RequestContext, rawFilters: unknown) {
  requirePermission(ctx, "graduate:read");
  const f = graduateFiltersSchema.parse(rawFilters ?? {});
  const where = buildGraduateWhere(f);
  const orderBy: Prisma.GraduateOrderByWithRelationInput[] =
    f.sort === "updated_asc" ? [{ currentStatusAt: { sort: "asc", nulls: "first" } }, { id: "asc" }]
    : f.sort === "updated_desc" ? [{ currentStatusAt: { sort: "desc", nulls: "last" } }, { id: "asc" }]
    : [{ fullName: "asc" }, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.graduate.count({ where }),
    prisma.graduate.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      // Deliberately no contact fields here.
      select: {
        id: true, fullName: true, preferredName: true, currentStatus: true, currentStatusAt: true, currentInField: true,
        jobSearchStatus: true, searchingSince: true,
        cohort: { select: { id: true, name: true } },
        skills: { select: { level: true, skill: { select: { canonicalName: true } } }, orderBy: { level: "desc" }, take: 4 },
      },
    }),
  ]);
  return { filters: f, total, page: f.page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows };
}

export async function getGraduateDetail(ctx: RequestContext, id: string) {
  requirePermission(ctx, "graduate:read");
  const g = await prisma.graduate.findUnique({
    where: { id },
    include: {
      cohort: { include: { program: true } },
      skills: { include: { skill: true }, orderBy: { level: "desc" } },
      employmentRecords: { include: { company: true, verifiedBy: { select: { name: true, email: true } } }, orderBy: [{ reportedAt: "desc" }, { createdAt: "desc" }] },
      surveys: { orderBy: { milestone: "asc" } },
      consents: { orderBy: { grantedAt: "desc" } },
      referrals: { include: { opening: { include: { company: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!g || g.anonymizedAt) throw new NotFoundError("Graduate");
  const auditTrail = await prisma.auditLog.findMany({ where: { entityType: "Graduate", entityId: id }, orderBy: { at: "desc" }, take: 50 });
  const actorIds = [...new Set(auditTrail.filter((a) => a.actorType === "user" && a.actorId).map((a) => a.actorId!))];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  const { emailEnc, phoneEnc, linkedinUrlEnc, emailHash: _h, ...safe } = g;
  return {
    ...safe,
    hasEmail: Boolean(emailEnc),
    hasPhone: Boolean(phoneEnc),
    hasLinkedin: Boolean(linkedinUrlEnc),
    effectiveGraduationDate: g.graduationDateOverride ?? g.cohort.graduationDate,
    auditTrail: auditTrail.map((a) => ({ ...a, actorLabel: a.actorType === "user" ? actors.get(a.actorId ?? "") ?? "Staff" : a.actorType })),
  };
}

/** Decrypts contact data. Every call is written to the audit log. */
export async function revealContact(ctx: RequestContext, id: string) {
  requirePermission(ctx, "graduate:read_contact");
  const g = await prisma.graduate.findUnique({ where: { id }, select: { emailEnc: true, phoneEnc: true, linkedinUrlEnc: true, anonymizedAt: true } });
  if (!g || g.anonymizedAt) throw new NotFoundError("Graduate");
  await audit(prisma, ctx, { action: "contact.read", entityType: "Graduate", entityId: id, meta: { fields: ["email", "phone", "linkedinUrl"] } });
  return { email: decryptOpt(g.emailEnc), phone: decryptOpt(g.phoneEnc), linkedinUrl: decryptOpt(g.linkedinUrlEnc) };
}

/** Form defaults for the edit page — includes contact data, so it is audited too. */
export async function getGraduateForEdit(ctx: RequestContext, id: string) {
  requirePermission(ctx, "graduate:write");
  const contact = await revealContact(ctx, id);
  const g = await prisma.graduate.findUniqueOrThrow({ where: { id }, include: { skills: { include: { skill: true } } } });
  return {
    id: g.id, fullName: g.fullName, preferredName: g.preferredName ?? "", email: contact.email ?? "", phone: contact.phone ?? "",
    linkedinUrl: contact.linkedinUrl ?? "", cohortId: g.cohortId, graduationDateOverride: g.graduationDateOverride, timezone: g.timezone ?? "",
    city: g.city ?? "", country: g.country ?? "", remotePreference: g.remotePreference, openToRelocate: g.openToRelocate,
    jobSearchStatus: g.jobSearchStatus, preferredRoleCategories: g.preferredRoleCategories,
    skills: g.skills.map((s) => ({ name: s.skill.canonicalName, level: s.level })),
  };
}

function contactData(input: GraduateInput) {
  return {
    emailEnc: encrypt(input.email),
    emailHash: blindIndex(input.email),
    phoneEnc: encryptOpt(input.phone),
    linkedinUrlEnc: encryptOpt(input.linkedinUrl),
  };
}

function profileData(input: GraduateInput) {
  return {
    fullName: input.fullName,
    preferredName: input.preferredName ?? null,
    cohortId: input.cohortId,
    graduationDateOverride: input.graduationDateOverride ?? null,
    timezone: input.timezone ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    remotePreference: input.remotePreference,
    openToRelocate: input.openToRelocate,
    jobSearchStatus: input.jobSearchStatus,
    preferredRoleCategories: input.preferredRoleCategories,
  };
}

export async function createGraduate(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "graduate:write");
  const input = graduateInputSchema.parse(raw);
  if (await prisma.graduate.findUnique({ where: { emailHash: blindIndex(input.email) } })) {
    throw new ConflictError("A graduate with this email already exists.");
  }
  const id = await prisma.$transaction(async (tx) => {
    const cohort = await tx.cohort.findUnique({ where: { id: input.cohortId } });
    if (!cohort) throw new NotFoundError("Cohort");
    const g = await tx.graduate.create({ data: { ...profileData(input), ...contactData(input) } });
    await setGraduateSkills(tx, g.id, input.skills);
    await audit(tx, ctx, { action: "graduate.create", entityType: "Graduate", entityId: g.id, before: null, after: { ...profileData(input), email: "x", phone: input.phone ? "x" : null } });
    return g.id;
  });
  await onGraduatesCreated(ctx, [id]);
  return id;
}

export async function updateGraduate(ctx: RequestContext, id: string, raw: unknown) {
  requirePermission(ctx, "graduate:write");
  const input = graduateInputSchema.parse(raw);
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.graduate.findUnique({ where: { id } });
    if (!before || before.anonymizedAt) throw new NotFoundError("Graduate");
    const hash = blindIndex(input.email);
    if (hash !== before.emailHash && (await tx.graduate.findUnique({ where: { emailHash: hash } }))) {
      throw new ConflictError("Another graduate already uses this email.");
    }
    const after = await tx.graduate.update({ where: { id }, data: { ...profileData(input), ...contactData(input) } });
    await setGraduateSkills(tx, id, input.skills);
    // emailEnc always changes (random IV); compare decrypted values so the diff is honest.
    const contactBefore = { email: decryptOpt(before.emailEnc), phone: decryptOpt(before.phoneEnc), linkedinUrl: decryptOpt(before.linkedinUrlEnc) };
    const contactAfter = { email: input.email, phone: input.phone ?? null, linkedinUrl: input.linkedinUrl ?? null };
    const strip = ({ emailEnc: _a, phoneEnc: _b, linkedinUrlEnc: _c, emailHash: _d, ...rest }: typeof before) => rest;
    await audit(tx, ctx, { action: "graduate.update", entityType: "Graduate", entityId: id, before: { ...strip(before), ...contactBefore }, after: { ...strip(after), ...contactAfter } });
    if (contactBefore.email !== input.email) await onStaffEmailChange(tx, ctx, id);
    return before.cohortId !== after.cohortId || before.graduationDateOverride?.getTime() !== after.graduationDateOverride?.getTime();
  });
  if (result) await onGraduateScheduleInputsChanged(ctx, id);
  return id;
}

/**
 * Staff changed the email (typically because the old address bounced). Distinctly audited;
 * links sent to the OLD address are revoked (the old inbox may belong to someone else now);
 * bounced/failed check-ins are re-sent to the new address.
 */
async function onStaffEmailChange(tx: Prisma.TransactionClient, ctx: RequestContext, id: string) {
  await tx.graduate.update({ where: { id }, data: { profileTokenVersion: { increment: 1 } } });
  const failed = await tx.outboundEmail.findMany({ where: { graduateId: id, kind: { in: ["survey_initial", "survey_reminder"] }, state: { in: ["dead", "uncertain", "failed"] } }, select: { id: true, payload: true } });
  for (const e of failed) {
    await tx.outboundEmail.update({ where: { id: e.id }, data: { state: "pending", attempts: 0, sendAfter: new Date(), lastError: null } });
    const surveyId = (e.payload as { surveyId?: string }).surveyId;
    if (surveyId) await tx.surveyInstance.updateMany({ where: { id: surveyId, status: { in: ["bounced", "cancelled"] } }, data: { status: "queued" } });
  }
  await audit(tx, ctx, { action: "graduate.email_changed_by_staff", entityType: "Graduate", entityId: id, meta: { linksRevoked: true, emailsRequeued: failed.length } });
}

/** Revokes every personal link previously sent to this graduate. */
export async function rotateProfileLink(ctx: RequestContext, id: string) {
  requirePermission(ctx, "graduate:rotate_link");
  const g = await prisma.graduate.update({ where: { id }, data: { profileTokenVersion: { increment: 1 } } });
  await audit(prisma, ctx, { action: "graduate.rotate_link", entityType: "Graduate", entityId: id, meta: { newVersion: g.profileTokenVersion } });
  return g.profileTokenVersion;
}

export async function listSkillsForFilter(ctx: RequestContext) {
  requirePermission(ctx, "graduate:read");
  return prisma.skill.findMany({ orderBy: { canonicalName: "asc" }, select: { id: true, canonicalName: true } });
}
