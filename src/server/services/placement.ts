/**
 * Placement board: matching (adapter around the pure engine), "You might be a fit" notifications,
 * graduate responses, and the referral pipeline with the partner-sharing gate.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { rankCandidates, rankOpenings, type MatchCandidate, type MatchOpening } from "@/domain/matching/match";
import { CLOSED, SHARES_WITH_PARTNER, allowedTargets, checkTransition, type TransitionContext } from "@/domain/referrals/pipeline";
import { referralMetrics } from "@/domain/referrals/metrics";
import { REFERRAL_STATUSES, type ReferralStatus } from "@/domain/enums";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { enqueueEmail } from "../outbox";
import { getSetting } from "../settings";
import { hasConsent } from "./consent";
import { appendEmploymentRecord, employmentInputSchema } from "./employment";

// ─── Adapters: database rows → matching inputs (allowlisted fields only) ───

const candidateSelect = {
  id: true, currentStatus: true, jobSearchStatus: true, remotePreference: true, openToRelocate: true, city: true, country: true,
  preferredRoleCategories: true, searchingSince: true, graduationDateOverride: true,
  cohort: { select: { graduationDate: true } },
  skills: { select: { skillId: true, level: true } },
  consents: { where: { purpose: "job_matching", revokedAt: null }, select: { id: true } },
} satisfies Prisma.GraduateSelect;
type CandidateRow = Prisma.GraduateGetPayload<{ select: typeof candidateSelect }>;

function toCandidate(g: CandidateRow): MatchCandidate {
  return {
    id: g.id,
    currentStatus: g.currentStatus,
    jobSearchStatus: g.jobSearchStatus,
    jobMatchingConsent: g.consents.length > 0,
    remotePreference: g.remotePreference,
    openToRelocate: g.openToRelocate,
    city: g.city,
    country: g.country,
    preferredRoleCategories: g.preferredRoleCategories,
    skills: new Map(g.skills.map((s) => [s.skillId, s.level])),
    graduationDate: g.graduationDateOverride ?? g.cohort.graduationDate,
    searchingSince: g.searchingSince,
  };
}

const openingSelect = { id: true, title: true, roleCategory: true, city: true, country: true, remoteMode: true, skills: { select: { skillId: true, weight: true, mustHave: true, skill: { select: { canonicalName: true } } } } } satisfies Prisma.OpeningSelect;
type OpeningRow = Prisma.OpeningGetPayload<{ select: typeof openingSelect }>;

function toOpening(o: OpeningRow): MatchOpening {
  return { id: o.id, title: o.title, roleCategory: o.roleCategory, city: o.city, country: o.country, remoteMode: o.remoteMode, skills: o.skills.map((s) => ({ skillId: s.skillId, name: s.skill.canonicalName, weight: s.weight, mustHave: s.mustHave })) };
}

/** Pre-filter in SQL to graduates who could possibly match; the engine applies the real filters. */
async function loadCandidates(db: Db, ids?: string[]) {
  const rows = await db.graduate.findMany({
    where: { anonymizedAt: null, ...(ids ? { id: { in: ids } } : { OR: [{ currentStatus: "searching" }, { jobSearchStatus: "open_to_offers" }] }) },
    select: candidateSelect,
  });
  return rows.map(toCandidate);
}

// ─── Matching views ───

export async function candidatesForOpening(ctx: RequestContext, openingId: string) {
  requirePermission(ctx, "opening:read");
  requirePermission(ctx, "graduate:read");
  const o = await prisma.opening.findUnique({ where: { id: openingId }, select: openingSelect });
  if (!o) throw new NotFoundError("Opening");
  const ranking = rankCandidates(toOpening(o), await loadCandidates(prisma), await getSetting("matching"));
  const ids = ranking.ranked.map((r) => r.candidateId);
  const [grads, notes, refs] = await Promise.all([
    prisma.graduate.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, preferredName: true, cohort: { select: { name: true } } } }),
    prisma.matchNotification.findMany({ where: { openingId, graduateId: { in: ids } } }),
    prisma.referral.findMany({ where: { openingId, graduateId: { in: ids } }, select: { graduateId: true, status: true } }),
  ]);
  const gm = new Map(grads.map((g) => [g.id, g]));
  const nm = new Map(notes.map((n) => [n.graduateId, n]));
  const rm = new Map(refs.map((r) => [r.graduateId, r.status]));
  return {
    excludedByReason: ranking.excludedByReason,
    ranked: ranking.ranked.map((m) => ({ ...m, graduate: gm.get(m.candidateId)!, notification: nm.get(m.candidateId) ?? null, referralStatus: rm.get(m.candidateId) ?? null })),
  };
}

export async function openingsForGraduate(ctx: RequestContext, graduateId: string) {
  requirePermission(ctx, "graduate:read");
  const [cand] = await loadCandidates(prisma, [graduateId]);
  if (!cand) throw new NotFoundError("Graduate");
  const openings = await prisma.opening.findMany({ where: { status: "open" }, select: openingSelect });
  const ranking = rankOpenings(cand, openings.map(toOpening), await getSetting("matching"));
  const meta = new Map((await prisma.opening.findMany({ where: { id: { in: ranking.ranked.map((r) => r.openingId) } }, select: { id: true, company: { select: { canonicalName: true } } } })).map((o) => [o.id, o]));
  const notified = new Set((await prisma.matchNotification.findMany({ where: { graduateId }, select: { openingId: true } })).map((n) => n.openingId));
  return {
    eligibilityProblems: ranking.ranked.length === 0 && ranking.excluded.length > 0 ? ranking.excluded[0]!.explanation.filter((e) => /searching|consent|agreed/i.test(e)) : [],
    ranked: ranking.ranked.map((m) => ({ ...m, title: openings.find((o) => o.id === m.openingId)!.title, companyName: meta.get(m.openingId)?.company.canonicalName ?? "", notified: notified.has(m.openingId) })),
  };
}

/** Count of open openings with zero eligible candidates (for the dashboard). */
export async function openingsWithoutMatches(ctx: RequestContext) {
  requirePermission(ctx, "opening:read");
  const [openings, candidates, cfg] = await Promise.all([prisma.opening.findMany({ where: { status: "open" }, select: { ...openingSelect, createdAt: true, company: { select: { canonicalName: true } } } }), loadCandidates(prisma), getSetting("matching")]);
  return openings.filter((o) => rankCandidates(toOpening(o), candidates, cfg).ranked.length === 0).map((o) => ({ id: o.id, title: o.title, companyName: o.company.canonicalName, createdAt: o.createdAt }));
}

// ─── Notifications & responses ───

export async function notifyGraduate(ctx: RequestContext, openingId: string, graduateId: string) {
  requirePermission(ctx, "referral:write");
  const o = await prisma.opening.findUnique({ where: { id: openingId }, select: { ...openingSelect, status: true, company: { select: { canonicalName: true } } } });
  if (!o || o.status !== "open") throw new ValidationError("This opening is not open.");
  const [cand] = await loadCandidates(prisma, [graduateId]);
  if (!cand) throw new NotFoundError("Graduate");
  const r = rankCandidates(toOpening(o), [cand], await getSetting("matching"));
  const m = r.ranked[0];
  if (!m) throw new ValidationError(`Not eligible for this opening: ${r.excluded[0]?.explanation.join(" ")}`);

  return prisma.$transaction(async (tx) => {
    if (await tx.matchNotification.findUnique({ where: { openingId_graduateId: { openingId, graduateId } } })) throw new ConflictError("This graduate was already notified about this opening.");
    const n = await tx.matchNotification.create({ data: { openingId, graduateId, sentById: ctx.actor.id, score: m.score } });
    let ref = await tx.referral.findUnique({ where: { openingId_graduateId: { openingId, graduateId } } });
    if (!ref) {
      ref = await tx.referral.create({ data: { openingId, graduateId, referredById: ctx.actor.id, status: "suggested" } });
      await tx.referralTransition.create({ data: { referralId: ref.id, fromStatus: null, toStatus: "suggested", actorId: ctx.actor.id, note: `Match score ${m.score}` } });
    }
    // Only the parts that make sense to the graduate (skills and location), never internal boosts.
    const explanation = m.explanation.filter((e) => /skills|Remote|city|relocate|location/i.test(e)).join(" ");
    await enqueueEmail(tx, { idempotencyKey: `match:${n.id}`, graduateId, kind: "match_notification", payload: { matchId: n.id, openingTitle: o.title, companyName: o.company.canonicalName, explanation } });
    await audit(tx, ctx, { action: "match.notify", entityType: "Graduate", entityId: graduateId, meta: { openingId, score: m.score } });
    return n.id;
  });
}

type GradCtx = RequestContext & { actor: { type: "graduate"; id: string } };
function requireGraduate(ctx: RequestContext): asserts ctx is GradCtx {
  if (ctx.actor.type !== "graduate") throw new ForbiddenError();
}

export async function getMatchForGraduate(ctx: RequestContext, matchId: string) {
  requireGraduate(ctx);
  const n = await prisma.matchNotification.findUnique({
    where: { id: matchId },
    include: { opening: { include: { company: { select: { canonicalName: true, industry: true } }, skills: { include: { skill: true } } } } },
  });
  if (!n || n.graduateId !== ctx.actor.id) throw new NotFoundError("Opening");
  const o = n.opening;
  return {
    id: n.id,
    response: n.response,
    open: o.status === "open",
    shareConsent: await hasConsent(prisma, ctx.actor.id, "share_with_partners"),
    opening: { title: o.title, companyName: o.company.canonicalName, industry: o.company.industry, description: o.description, city: o.city, country: o.country, remoteMode: o.remoteMode, seniority: o.seniority, salaryBand: o.salaryBand, deadline: o.deadline, skills: o.skills.map((s) => ({ name: s.skill.canonicalName, mustHave: s.mustHave })) },
  };
}

export async function listMatchesForGraduate(ctx: RequestContext) {
  requireGraduate(ctx);
  return prisma.matchNotification.findMany({
    where: { graduateId: ctx.actor.id, opening: { status: "open" } },
    orderBy: { sentAt: "desc" },
    select: { id: true, response: true, opening: { select: { title: true, company: { select: { canonicalName: true } } } } },
  });
}

/** One-click Interested / Not interested from the graduate's link. */
export async function respondToMatch(ctx: RequestContext, matchId: string, response: "interested" | "not_interested") {
  requireGraduate(ctx);
  z.enum(["interested", "not_interested"]).parse(response);
  await prisma.$transaction(async (tx) => {
    const n = await tx.matchNotification.findUnique({ where: { id: matchId } });
    if (!n || n.graduateId !== ctx.actor.id) throw new NotFoundError("Opening");
    const ref = await tx.referral.findUnique({ where: { openingId_graduateId: { openingId: n.openingId, graduateId: n.graduateId } } });
    if (ref && !["suggested", "graduate_interested", "withdrawn"].includes(ref.status)) throw new ConflictError("Your application is already in progress — contact the careers team to change it.");
    await tx.matchNotification.update({ where: { id: matchId }, data: { response, respondedAt: new Date() } });
    if (ref) {
      const to: ReferralStatus = response === "interested" ? "graduate_interested" : "withdrawn";
      if (ref.status !== to) await applyTransition(tx, ctx, ref.id, ref.status, to, response === "not_interested" ? "Graduate not interested" : "Graduate interested");
    }
    await audit(tx, ctx, { action: `match.${response}`, entityType: "Graduate", entityId: ctx.actor.id, meta: { openingId: n.openingId } });
  });
}

// ─── Referral pipeline ───

async function transitionContext(db: Db, referralId: string, actor: "staff" | "graduate"): Promise<TransitionContext & { graduateId: string }> {
  const ref = await db.referral.findUniqueOrThrow({ where: { id: referralId }, include: { transitions: { orderBy: { at: "asc" } } } });
  const notification = await db.matchNotification.findUnique({ where: { openingId_graduateId: { openingId: ref.openingId, graduateId: ref.graduateId } } });
  const interested = notification?.response === "interested" || (notification === null && ref.transitions.some((t) => t.toStatus === "graduate_interested"));
  const lastOpen = [...ref.transitions].reverse().find((t) => !CLOSED.includes(t.toStatus))?.toStatus;
  return { actor, interested, shareConsent: await hasConsent(db, ref.graduateId, "share_with_partners"), lastOpenStatus: lastOpen, graduateId: ref.graduateId };
}

async function applyTransition(tx: Db, ctx: RequestContext, referralId: string, from: ReferralStatus, to: ReferralStatus, note?: string) {
  const at = new Date();
  await tx.referral.update({ where: { id: referralId }, data: { status: to, statusChangedAt: at } });
  await tx.referralTransition.create({ data: { referralId, fromStatus: from, toStatus: to, actorId: ctx.actor.type === "user" ? ctx.actor.id : null, at, note: note ?? null } });
  await audit(tx, ctx, { action: "referral.move", entityType: "Referral", entityId: referralId, before: { status: from }, after: { status: to } });
}

export async function moveReferral(ctx: RequestContext, referralId: string, rawTo: unknown, note?: string) {
  requirePermission(ctx, "referral:write");
  const to = z.enum(REFERRAL_STATUSES).parse(rawTo);
  return prisma.$transaction(async (tx) => {
    const ref = await tx.referral.findUnique({ where: { id: referralId }, include: { opening: { include: { company: true } } } });
    if (!ref) throw new NotFoundError("Referral");
    const tctx = await transitionContext(tx, referralId, "staff");
    const check = checkTransition(ref.status, to, tctx);
    if (!check.ok) throw new ValidationError(check.reason);
    await applyTransition(tx, ctx, referralId, ref.status, to, note?.slice(0, 500));

    let hireRecordId: string | null = null;
    if (to === "hired") {
      // Acceptance: a hire produces an employment record (prefilled; staff confirm or correct it).
      const rec = await appendEmploymentRecord(tx, ctx, ref.graduateId, employmentInputSchema.parse({
        status: "employed_full_time", companyName: ref.opening.company.canonicalName, roleTitle: ref.opening.title,
        roleCategory: ref.opening.roleCategory ?? undefined, employmentType: "full_time", salaryBand: ref.opening.salaryBand ?? undefined,
      }), { source: "referral_hire" });
      await tx.referral.update({ where: { id: referralId }, data: { hireRecordId: rec.id } });
      await tx.graduate.update({ where: { id: ref.graduateId }, data: { jobSearchStatus: "not_looking" } });
      hireRecordId = rec.id;
    }
    return { hireRecordId };
  });
}

export const confirmHireSchema = z.object({
  employmentStatus: z.enum(["employed_full_time", "employed_part_time", "freelance_contract", "internship"]),
  roleTitle: z.string().trim().max(150).optional(),
  startDate: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
  inField: z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : undefined), z.boolean().optional()),
});

/** Confirms (verifies) the hire record, appending a corrected, verified record if staff changed anything. */
export async function confirmHire(ctx: RequestContext, referralId: string, raw: unknown) {
  requirePermission(ctx, "employment:write");
  const input = confirmHireSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const ref = await tx.referral.findUnique({ where: { id: referralId }, include: { opening: { include: { company: true } } } });
    if (!ref?.hireRecordId) throw new NotFoundError("Hire record");
    const rec = await tx.employmentRecord.findUniqueOrThrow({ where: { id: ref.hireRecordId } });
    const changed = input.employmentStatus !== rec.status || (input.roleTitle ?? rec.roleTitle) !== rec.roleTitle || input.startDate !== undefined || input.inField !== undefined;
    if (!changed) {
      await tx.employmentRecord.update({ where: { id: rec.id }, data: { verifiedById: ctx.actor.id } });
      await audit(tx, ctx, { action: "employment.verify", entityType: "Graduate", entityId: ref.graduateId, meta: { recordId: rec.id } });
      return;
    }
    const corrected = await appendEmploymentRecord(tx, ctx, ref.graduateId, employmentInputSchema.parse({
      status: input.employmentStatus, companyName: ref.opening.company.canonicalName, roleTitle: input.roleTitle ?? rec.roleTitle ?? undefined,
      roleCategory: rec.roleCategory ?? undefined, startDate: input.startDate, inField: input.inField, employmentType: rec.employmentType ?? undefined,
      salaryBand: rec.salaryBand ?? undefined, supersedesId: rec.id,
    }), { source: "referral_hire", verified: true });
    await tx.referral.update({ where: { id: referralId }, data: { hireRecordId: corrected.id } });
  });
}

export const referralFiltersSchema = z.object({ status: z.enum([...REFERRAL_STATUSES, "all", "open"]).default("open").catch("open"), openingId: z.string().optional() });

export async function listReferrals(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "referral:read");
  const f = referralFiltersSchema.parse(raw ?? {});
  const where: Prisma.ReferralWhereInput = {
    ...(f.status === "all" ? {} : f.status === "open" ? { status: { notIn: ["hired", "rejected", "withdrawn"] } } : { status: f.status }),
    ...(f.openingId ? { openingId: f.openingId } : {}),
    graduate: { anonymizedAt: null },
  };
  const rows = await prisma.referral.findMany({
    where,
    orderBy: { statusChangedAt: "asc" },
    include: { opening: { select: { id: true, title: true, company: { select: { canonicalName: true } } } }, graduate: { select: { id: true, fullName: true } }, referredBy: { select: { name: true } } },
    take: 1000,
  });
  // Allowed next steps per card (same rules the server enforces on move).
  const withTargets = await Promise.all(rows.map(async (r) => ({ ...r, allowed: allowedTargets(r.status, await transitionContext(prisma, r.id, "staff")) })));
  return { filters: f, rows: withTargets };
}

export async function referralMetricsView(ctx: RequestContext) {
  requirePermission(ctx, "referral:read");
  const refs = await prisma.referral.findMany({
    include: { transitions: { select: { toStatus: true, at: true }, orderBy: { at: "asc" } }, opening: { select: { id: true, title: true, company: { select: { id: true, canonicalName: true, isPartner: true } } } } },
  });
  const m = referralMetrics(refs.map((r) => ({ id: r.id, openingId: r.openingId, companyId: r.opening.company.id, companyName: r.opening.company.canonicalName, isPartner: r.opening.company.isPartner, status: r.status, transitions: r.transitions })));
  const titles = new Map(refs.map((r) => [r.openingId, `${r.opening.title} · ${r.opening.company.canonicalName}`]));
  return { ...m, perOpening: [...m.perOpening].map(([id, n]) => ({ id, title: titles.get(id) ?? id, n })).sort((a, b) => b.n - a.n) };
}

export { SHARES_WITH_PARTNER };
