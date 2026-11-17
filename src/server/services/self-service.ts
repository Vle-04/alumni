/**
 * Everything a graduate can do through their personal link. The actor is always
 * { type: "graduate", id } taken from the verified session — a graduate can only ever
 * read or change their own record.
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import { CONSENT_PURPOSES, JOB_SEARCH_STATUSES, REMOTE_PREFERENCES, ROLE_CATEGORIES, type ConsentPurpose } from "@/domain/enums";
import { answersToEmployment, surveyAnswerSchema, type LastKnown } from "@/domain/surveys/form";
import { normalizeEmail } from "@/domain/import/graduateCsv";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import type { RequestContext } from "../context";
import { blindIndex, decryptOpt, encrypt, hashSecret, maskEmail, safeEqualHex } from "../crypto";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "../errors";
import { deliverNow, enqueueEmail, otpPayload } from "../outbox";
import { checkRateLimit } from "../rate-limit";
import { activeConsents, setConsent } from "./consent";
import { appendEmploymentRecord, employmentInputSchema, type RecordSource } from "./employment";
import { setGraduateSkills } from "./skills";

type GradCtx = RequestContext & { actor: { type: "graduate"; id: string } };

function requireGraduate(ctx: RequestContext): asserts ctx is GradCtx {
  if (ctx.actor.type !== "graduate") throw new ForbiddenError();
}

async function lastKnown(db: Db, graduateId: string): Promise<LastKnown | null> {
  const r = await db.employmentRecord.findFirst({ where: { graduateId }, orderBy: [{ reportedAt: "desc" }, { createdAt: "desc" }], include: { company: true } });
  if (!r) return null;
  return { status: r.status, companyName: r.company?.canonicalName ?? null, roleTitle: r.roleTitle, startDate: r.startDate, inField: r.inField, salaryBand: r.salaryBand, roleCategory: r.roleCategory };
}

export async function getSelfServiceView(ctx: RequestContext) {
  requireGraduate(ctx);
  const g = await prisma.graduate.findUnique({
    where: { id: ctx.actor.id },
    include: { cohort: true, skills: { include: { skill: true }, orderBy: { level: "desc" } }, surveys: { where: { status: { in: ["queued", "sent"] } }, orderBy: { milestone: "asc" } } },
  });
  if (!g || g.anonymizedAt) throw new NotFoundError("Profile");
  const email = decryptOpt(g.emailEnc);
  return {
    firstName: g.preferredName ?? g.fullName.split(" ")[0] ?? "",
    cohortName: g.cohort.name,
    maskedEmail: email ? maskEmail(email) : null,
    unsubscribed: Boolean(g.unsubscribedAt),
    last: await lastKnown(prisma, g.id),
    consents: [...(await activeConsents(prisma, g.id))],
    openSurveys: g.surveys.map((s) => ({ id: s.id, milestone: s.milestone })),
    prefs: {
      jobSearchStatus: g.jobSearchStatus,
      remotePreference: g.remotePreference,
      openToRelocate: g.openToRelocate,
      city: g.city ?? "",
      country: g.country ?? "",
      preferredRoleCategories: g.preferredRoleCategories,
      skills: g.skills.map((s) => ({ name: s.skill.canonicalName, level: s.level })),
    },
  };
}

export async function getSurveyForGraduate(ctx: RequestContext, surveyId: string) {
  requireGraduate(ctx);
  const s = await prisma.surveyInstance.findUnique({ where: { id: surveyId } });
  if (!s || s.graduateId !== ctx.actor.id) throw new NotFoundError("Check-in");
  if (!s.openedAt) await prisma.surveyInstance.update({ where: { id: s.id }, data: { openedAt: new Date() } });
  return { id: s.id, milestone: s.milestone, open: s.status === "sent" || s.status === "queued" || s.status === "bounced", last: await lastKnown(prisma, ctx.actor.id) };
}

async function recordAnswers(db: Db, ctx: GradCtx, raw: unknown, source: RecordSource, surveyInstanceId?: string) {
  const answers = surveyAnswerSchema.parse(raw);
  const mapped = answersToEmployment(answers, await lastKnown(db, ctx.actor.id), new Date());
  if (!mapped.ok) throw new ValidationError("Please check your answers.", mapped.fieldErrors);
  const record = await appendEmploymentRecord(db, ctx, ctx.actor.id, employmentInputSchema.parse(mapped.record), { source, surveyInstanceId });
  if (mapped.jobSearchStatus) await db.graduate.update({ where: { id: ctx.actor.id }, data: { jobSearchStatus: mapped.jobSearchStatus } });
  return { answers, record };
}

/** Answers a milestone survey. Exactly once: a second submission is rejected. */
export async function submitSurvey(ctx: RequestContext, surveyId: string, raw: unknown) {
  requireGraduate(ctx);
  return prisma.$transaction(async (tx) => {
    const s = await tx.surveyInstance.findUnique({ where: { id: surveyId } });
    if (!s || s.graduateId !== ctx.actor.id) throw new NotFoundError("Check-in");
    const claimed = await tx.surveyInstance.updateMany({ where: { id: surveyId, status: { in: ["queued", "sent", "bounced"] } }, data: { status: "completed", completedAt: new Date() } });
    if (claimed.count === 0) throw new ConflictError("This check-in is already answered or closed.");
    const source = `survey_${s.milestone}m` as RecordSource;
    const { answers } = await recordAnswers(tx, ctx, raw, source, surveyId);
    await tx.surveyResponse.create({ data: { surveyInstanceId: surveyId, answers } });
    await audit(tx, ctx, { action: "survey.complete", entityType: "Graduate", entityId: ctx.actor.id, meta: { surveyId, milestone: s.milestone, mode: answers.mode } });
  });
}

/** Self-update at any time. Also suppresses a milestone survey due within the skip window. */
export async function submitSelfUpdate(ctx: RequestContext, raw: unknown) {
  requireGraduate(ctx);
  await prisma.$transaction(async (tx) => {
    await recordAnswers(tx, ctx, raw, "self_update");
    await tx.graduate.update({ where: { id: ctx.actor.id }, data: { lastSelfUpdateAt: new Date() } });
    await audit(tx, ctx, { action: "graduate.self_update", entityType: "Graduate", entityId: ctx.actor.id });
  });
}

export const preferencesSchema = z.object({
  jobSearchStatus: z.enum(JOB_SEARCH_STATUSES),
  remotePreference: z.enum(REMOTE_PREFERENCES),
  openToRelocate: z.boolean(),
  city: z.string().trim().max(100).optional().transform((v) => v || null),
  country: z.string().trim().max(100).optional().transform((v) => v || null),
  preferredRoleCategories: z.array(z.enum(ROLE_CATEGORIES)).max(5),
  skills: z.array(z.object({ name: z.string().trim().min(1).max(60), level: z.coerce.number().int().min(1).max(5) })).max(30),
});

export async function updatePreferences(ctx: RequestContext, raw: unknown) {
  requireGraduate(ctx);
  const { skills, ...data } = preferencesSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const before = await tx.graduate.findUniqueOrThrow({ where: { id: ctx.actor.id }, select: { jobSearchStatus: true, remotePreference: true, openToRelocate: true, city: true, country: true, preferredRoleCategories: true } });
    await tx.graduate.update({ where: { id: ctx.actor.id }, data });
    await setGraduateSkills(tx, ctx.actor.id, skills);
    await audit(tx, ctx, { action: "graduate.update_preferences", entityType: "Graduate", entityId: ctx.actor.id, before, after: data });
  });
}

/** Grants/revokes each purpose. Effective immediately — nothing caches consent. */
export async function updateConsents(ctx: RequestContext, granted: Partial<Record<ConsentPurpose, boolean>>) {
  requireGraduate(ctx);
  await prisma.$transaction(async (tx) => {
    for (const purpose of CONSENT_PURPOSES) {
      if (granted[purpose] !== undefined) await setConsent(tx, ctx, ctx.actor.id, purpose, granted[purpose]!, "self_update");
    }
  });
}

export async function setEmailSubscription(ctx: RequestContext, subscribed: boolean) {
  requireGraduate(ctx);
  await prisma.graduate.update({ where: { id: ctx.actor.id }, data: { unsubscribedAt: subscribed ? null : new Date() } });
  await audit(prisma, ctx, { action: subscribed ? "graduate.resubscribe" : "graduate.unsubscribe", entityType: "Graduate", entityId: ctx.actor.id });
}

/** One-click unsubscribe from an email link (no session needed; token already verified). */
export async function unsubscribeByToken(graduateId: string) {
  const r = await prisma.graduate.updateMany({ where: { id: graduateId, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  if (r.count) await audit(prisma, { actor: { type: "graduate", id: graduateId } }, { action: "graduate.unsubscribe", entityType: "Graduate", entityId: graduateId, meta: { via: "email_link" } });
}

// ─── New link request (never reveals whether the email exists) ───

export async function requestNewLink(rawEmail: string, ip: string): Promise<"ok" | "rate_limited"> {
  const email = z.string().trim().pipe(z.email()).safeParse(rawEmail);
  if (!(await checkRateLimit(`link:ip:${ip}`, 10, 15 * 60))) return "rate_limited";
  if (!email.success) return "ok";
  const normalized = normalizeEmail(email.data);
  if (!(await checkRateLimit(`link:email:${normalized}`, 3, 60 * 60))) return "ok"; // silently drop; same response
  const g = await prisma.graduate.findUnique({ where: { emailHash: blindIndex(normalized) }, select: { id: true, anonymizedAt: true } });
  if (g && !g.anonymizedAt) {
    const id = await enqueueEmail(prisma, { idempotencyKey: `link:self:${g.id}:${Math.floor(Date.now() / 60_000)}`, graduateId: g.id, kind: "profile_link" });
    await audit(prisma, { actor: { type: "graduate", id: g.id }, ip }, { action: "graduate.request_link", entityType: "Graduate", entityId: g.id });
    await deliverNow(id);
  }
  return "ok";
}

// ─── One-time codes for sensitive actions ───

export const OTP_PURPOSES = ["change_email", "export_data", "delete_account"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/** Sends a 6-digit code to the email ON FILE. */
export async function requestOtp(ctx: RequestContext, purpose: OtpPurpose) {
  requireGraduate(ctx);
  if (!(await checkRateLimit(`otp:${ctx.actor.id}`, 3, 15 * 60))) throw new RateLimitError(15 * 60);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.oneTimeCode.updateMany({ where: { graduateId: ctx.actor.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }); // older codes stop working
  const otp = await prisma.oneTimeCode.create({ data: { graduateId: ctx.actor.id, purpose, codeHash: hashSecret(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  const id = await enqueueEmail(prisma, { idempotencyKey: `otp:${otp.id}`, graduateId: ctx.actor.id, kind: "otp", payload: otpPayload(code, purpose) });
  await audit(prisma, ctx, { action: "otp.request", entityType: "Graduate", entityId: ctx.actor.id, meta: { purpose } });
  await deliverNow(id);
}

/** Verifies and consumes a code. Throws ValidationError with a generic message on any failure. */
export async function consumeOtp(db: Db, graduateId: string, purpose: OtpPurpose, code: string) {
  const fail = () => new ValidationError("That code is wrong or has expired. Request a new one.", { code: ["That code is wrong or has expired."] });
  const otp = await db.oneTimeCode.findFirst({ where: { graduateId, purpose, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) throw fail();
  await db.oneTimeCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  if (!/^\d{6}$/.test(code.trim()) || !safeEqualHex(hashSecret(code.trim()), otp.codeHash)) throw fail();
  const consumed = await db.oneTimeCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (!consumed.count) throw fail();
}

export async function changeEmail(ctx: RequestContext, raw: unknown) {
  requireGraduate(ctx);
  const input = z.object({ code: z.string().trim(), newEmail: z.string().trim().pipe(z.email("Enter a valid email")).transform(normalizeEmail) }).parse(raw);
  // Consume the code in its own transaction so failed attempts are counted even if the change fails.
  await consumeOtp(prisma, ctx.actor.id, "change_email", input.code);
  await prisma.$transaction(async (tx) => {
    const hash = blindIndex(input.newEmail);
    const other = await tx.graduate.findUnique({ where: { emailHash: hash }, select: { id: true } });
    if (other && other.id !== ctx.actor.id) throw new ConflictError("This email can't be used. Please contact the Academy careers team.");
    await tx.graduate.update({ where: { id: ctx.actor.id }, data: { emailEnc: encrypt(input.newEmail), emailHash: hash } });
    await audit(tx, ctx, { action: "graduate.change_email", entityType: "Graduate", entityId: ctx.actor.id, before: { email: "old" }, after: { email: "new" } });
  });
}
