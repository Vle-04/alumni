/**
 * Data-subject rights: export ("download my data") and deletion, plus retention.
 *
 * Deletion = anonymization. Personal data is removed; rows that feed aggregate statistics are
 * kept without anything that identifies the person, so historical reports don't change:
 *   KEPT     cohort, graduation date override, consent states (for reporting inclusion),
 *            employment history (status, company, dates, salary band, role category),
 *            survey statuses, referral stages and their timestamps
 *   REMOVED  name, email, phone, LinkedIn URL, location, time zone, preferences, skills,
 *            survey free-form answers, referral notes, one-time codes, pending emails
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { blindIndex, decryptOpt } from "../crypto";
import { scrubAuditPayload } from "@/domain/audit/redact";
import type { Prisma } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "../errors";
import { getSetting } from "../settings";
import { consumeOtp } from "./self-service";
import { addMonthsUtc } from "@/domain/records/staleness";

export async function anonymizeGraduate(db: Db, ctx: RequestContext, graduateId: string, reason: "self_request" | "staff_request" | "retention") {
  const g = await db.graduate.findUnique({ where: { id: graduateId }, select: { id: true, anonymizedAt: true, fullName: true, preferredName: true, emailEnc: true, phoneEnc: true } });
  if (!g) throw new NotFoundError("Graduate");
  if (g.anonymizedAt) return;
  const email = decryptOpt(g.emailEnc);
  const needles = [g.fullName, ...g.fullName.split(/\s+/).filter((p) => p.length >= 4), g.preferredName ?? "", email ?? "", decryptOpt(g.phoneEnc) ?? ""].filter(Boolean);
  const label = `Deleted graduate #${createHash("sha256").update(g.id).digest("hex").slice(0, 8)}`;
  await db.graduate.update({
    where: { id: graduateId },
    data: {
      fullName: label, preferredName: null, emailEnc: null, emailHash: null, phoneEnc: null, linkedinUrlEnc: null,
      city: null, country: null, timezone: null, preferredRoleCategories: [], contactPrefs: {}, remotePreference: "any",
      openToRelocate: false, jobSearchStatus: "not_looking", lastSelfUpdateAt: null,
      unsubscribedAt: new Date(), anonymizedAt: new Date(), profileTokenVersion: { increment: 1 },
    },
  });
  await db.graduateSkill.deleteMany({ where: { graduateId } });
  await db.oneTimeCode.deleteMany({ where: { graduateId } });
  await db.surveyResponse.updateMany({ where: { survey: { graduateId } }, data: { answers: {} } });
  await db.surveyInstance.updateMany({ where: { graduateId, status: { in: ["scheduled", "queued"] } }, data: { status: "cancelled" } });
  await db.outboundEmail.deleteMany({ where: { graduateId, state: { in: ["pending", "failed", "uncertain", "dead"] } } });
  await db.outboundEmail.updateMany({ where: { graduateId }, data: { payload: {}, lastError: null } });
  await db.referral.updateMany({ where: { graduateId }, data: { notes: null } });
  await db.referralTransition.updateMany({ where: { referral: { graduateId } }, data: { note: null } });
  await scrubLinkedFreeText(db, graduateId, needles);

  // Audit log: scrub stored diffs/meta about this person (rows about them, rows by them, and any
  // other row whose payload contains their name/email/phone), and drop IPs/UAs of their own actions.
  const mentioning = await findIdsMentioning(db, `"AuditLog"`, `diff::text`, needles);
  const rows = await db.auditLog.findMany({
    where: { OR: [{ entityId: graduateId }, { actorType: "graduate", actorId: graduateId }, { id: { in: mentioning } }] },
    select: { id: true, diff: true, actorType: true, actorId: true, ip: true },
  });
  const ownIps = new Set<string>();
  for (const r of rows) {
    const own = r.actorType === "graduate" && r.actorId === graduateId;
    if (own && r.ip) ownIps.add(r.ip);
    await db.auditLog.update({
      where: { id: r.id },
      data: { diff: r.diff === null ? undefined : (scrubAuditPayload(r.diff, needles) as Prisma.InputJsonValue), ...(own ? { ip: null, userAgent: null } : {}) },
    });
  }
  if (ctx.actor.type === "graduate" && ctx.ip) ownIps.add(ctx.ip);
  // Rate-limit keys may contain a keyed hash of the email (new-link requests) or the person's IPs.
  // Removing a counter only resets a limit, so this is always safe.
  if (email) await db.rateLimitBucket.deleteMany({ where: { key: { contains: blindIndex(email).slice(0, 24) } } });
  for (const ip of ownIps) await db.rateLimitBucket.deleteMany({ where: { key: { contains: ip } } });
  // The deletion's own audit entry must not re-introduce the person's IP / device.
  const auditCtx = ctx.actor.type === "graduate" ? { actor: ctx.actor } : ctx;
  await audit(db, auditCtx, { action: "graduate.anonymize", entityType: "Graduate", entityId: graduateId, meta: { reason } });
}

/** Case-insensitively replaces every needle in `text` with "[removed]". */
export function removeNeedles(text: string, needles: readonly string[]): string {
  let out = text;
  for (const n of [...needles].filter((x) => x.trim().length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[removed]");
  }
  return out;
}

async function findIdsMentioning(db: Db, table: string, column: string, needles: readonly string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const n of needles.filter((x) => x.trim().length >= 3)) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${table} WHERE ${column} ILIKE $1`, `%${n}%`);
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

/**
 * Free text linked to the graduate may contain their name/email/phone (typed by them or by staff).
 * Replace those strings with "[removed]" — never touching structured fields that metrics use
 * (status, dates, company id, role category).
 */
async function scrubLinkedFreeText(db: Db, graduateId: string, needles: readonly string[]) {
  const has = (t: string | null | undefined) => Boolean(t) && removeNeedles(t!, needles) !== t;
  // Job titles in their employment history.
  for (const r of await db.employmentRecord.findMany({ where: { graduateId }, select: { id: true, roleTitle: true, companyId: true } })) {
    if (has(r.roleTitle)) await db.employmentRecord.update({ where: { id: r.id }, data: { roleTitle: removeNeedles(r.roleTitle!, needles) } });
  }
  // Company names they typed (shared rows: rename in place, keep the id so metrics are unchanged).
  const companyIds = (await db.employmentRecord.findMany({ where: { graduateId, companyId: { not: null } }, select: { companyId: true } })).map((r) => r.companyId!);
  for (const c of await db.company.findMany({ where: { id: { in: companyIds } }, include: { aliases: true } })) {
    if (has(c.canonicalName)) {
      let name = removeNeedles(c.canonicalName, needles);
      for (let i = 2; await db.company.findFirst({ where: { canonicalName: name, NOT: { id: c.id } } }); i++) name = `${removeNeedles(c.canonicalName, needles)} (${i})`;
      await db.company.update({ where: { id: c.id }, data: { canonicalName: name } });
    }
    for (const a of c.aliases) if (has(a.alias)) await db.companyAlias.delete({ where: { id: a.id } });
  }
  // Openings they were suggested for / referred to.
  const openingIds = [
    ...(await db.referral.findMany({ where: { graduateId }, select: { openingId: true } })).map((r) => r.openingId),
    ...(await db.matchNotification.findMany({ where: { graduateId }, select: { openingId: true } })).map((r) => r.openingId),
  ];
  for (const o of await db.opening.findMany({ where: { id: { in: openingIds } }, select: { id: true, title: true, description: true } })) {
    if (has(o.title) || has(o.description)) {
      await db.opening.update({ where: { id: o.id }, data: { title: removeNeedles(o.title, needles), description: removeNeedles(o.description, needles) } });
    }
  }
  // Queued/sent email payloads of OTHER graduates that quote that text (e.g. an opening title).
  for (const id of await findIdsMentioning(db, `"OutboundEmail"`, `payload::text`, needles)) {
    const e = await db.outboundEmail.findUniqueOrThrow({ where: { id }, select: { payload: true } });
    await db.outboundEmail.update({ where: { id }, data: { payload: scrubAuditPayload(e.payload, needles) as Prisma.InputJsonValue } });
  }
}

/** Everything we hold about the graduate, in plain JSON. */
export async function buildDataExport(graduateId: string) {
  const g = await prisma.graduate.findUnique({
    where: { id: graduateId },
    include: {
      cohort: { include: { program: true } },
      skills: { include: { skill: true } },
      employmentRecords: { include: { company: true }, orderBy: { reportedAt: "asc" } },
      consents: { orderBy: { grantedAt: "asc" } },
      surveys: { include: { response: true }, orderBy: { milestone: "asc" } },
      notifications: { include: { opening: { include: { company: true } } } },
      referrals: { include: { opening: { include: { company: true } }, transitions: { orderBy: { at: "asc" } } } },
    },
  });
  if (!g || g.anonymizedAt) throw new NotFoundError("Profile");
  return {
    exportedAt: new Date().toISOString(),
    about: "All personal data the Academy's Alumni Tracker holds about you. See the privacy notice for how it is used.",
    profile: {
      fullName: g.fullName, preferredName: g.preferredName, email: decryptOpt(g.emailEnc), phone: decryptOpt(g.phoneEnc), linkedinUrl: decryptOpt(g.linkedinUrlEnc),
      program: g.cohort.program.name, cohort: g.cohort.name, graduationDate: (g.graduationDateOverride ?? g.cohort.graduationDate)?.toISOString().slice(0, 10) ?? null,
      city: g.city, country: g.country, timezone: g.timezone, remotePreference: g.remotePreference, openToRelocate: g.openToRelocate,
      jobSearchStatus: g.jobSearchStatus, preferredRoleCategories: g.preferredRoleCategories, checkInEmails: g.unsubscribedAt ? "off" : "on",
    },
    skills: g.skills.map((s) => ({ skill: s.skill.canonicalName, level: s.level })),
    employmentHistory: g.employmentRecords.map((r) => ({
      status: r.status, company: r.company?.canonicalName ?? null, roleTitle: r.roleTitle, roleCategory: r.roleCategory, inField: r.inField,
      startDate: r.startDate?.toISOString().slice(0, 10) ?? null, endDate: r.endDate?.toISOString().slice(0, 10) ?? null, salaryBand: r.salaryBand,
      source: r.source, reportedAt: r.reportedAt.toISOString(), searchBlockers: r.searchBlockers, helpWanted: r.helpWanted,
    })),
    consents: g.consents.map((c) => ({ purpose: c.purpose, policyVersion: c.policyVersion, grantedAt: c.grantedAt.toISOString(), revokedAt: c.revokedAt?.toISOString() ?? null, source: c.source })),
    checkIns: g.surveys.map((s) => ({ milestoneMonths: s.milestone, status: s.status, scheduledFor: s.scheduledFor.toISOString(), sentAt: s.sentAt?.toISOString() ?? null, completedAt: s.completedAt?.toISOString() ?? null, answers: s.response?.answers ?? null })),
    jobSuggestions: g.notifications.map((n) => ({ opening: n.opening.title, company: n.opening.company.canonicalName, sentAt: n.sentAt.toISOString(), yourResponse: n.response })),
    referrals: g.referrals.map((r) => ({ opening: r.opening.title, company: r.opening.company.canonicalName, status: r.status, history: r.transitions.map((t) => ({ status: t.toStatus, at: t.at.toISOString() })) })),
  };
}

function requireGraduate(ctx: RequestContext): asserts ctx is RequestContext & { actor: { type: "graduate"; id: string } } {
  if (ctx.actor.type !== "graduate") throw new ForbiddenError();
}

/** Graduate: download my data (needs a one-time code sent to the email on file). */
export async function exportMyData(ctx: RequestContext, rawCode: unknown) {
  requireGraduate(ctx);
  await consumeOtp(prisma, ctx.actor.id, "export_data", z.string().parse(rawCode));
  const data = await buildDataExport(ctx.actor.id);
  await audit(prisma, ctx, { action: "data.export_self", entityType: "Graduate", entityId: ctx.actor.id });
  return data;
}

/** Graduate: delete my account (needs a one-time code). Takes effect immediately. */
export async function deleteMyAccount(ctx: RequestContext, rawCode: unknown) {
  requireGraduate(ctx);
  await consumeOtp(prisma, ctx.actor.id, "delete_account", z.string().parse(rawCode));
  await prisma.$transaction((tx) => anonymizeGraduate(tx, ctx, ctx.actor.id, "self_request"));
}

/** Admin: delete a graduate on request (e.g. by email to the Academy). */
export async function deleteGraduateAsStaff(ctx: RequestContext, graduateId: string, rawConfirm: unknown) {
  requirePermission(ctx, "graduate:delete");
  z.literal("DELETE", { error: "Type DELETE to confirm" }).parse(rawConfirm);
  await prisma.$transaction((tx) => anonymizeGraduate(tx, ctx, graduateId, "staff_request"));
}

/** Admin: export a graduate's data on their behalf (e.g. a request by post). */
export async function exportGraduateDataAsStaff(ctx: RequestContext, graduateId: string) {
  requirePermission(ctx, "data:export_all");
  const data = await buildDataExport(graduateId);
  await audit(prisma, ctx, { action: "data.export_subject", entityType: "Graduate", entityId: graduateId });
  return data;
}

// ─── Retention (scheduled job) ───

export async function runRetention(now = new Date()) {
  const cfg = await getSetting("retention");
  const ctx = { actor: { type: "system" as const, id: "retention" } };
  const candidates = await prisma.graduate.findMany({
    where: { anonymizedAt: null },
    select: { id: true, graduationDateOverride: true, cohort: { select: { graduationDate: true } } },
  });
  const due = candidates.filter((g) => {
    const d = g.graduationDateOverride ?? g.cohort.graduationDate;
    return d && addMonthsUtc(d, cfg.anonymizeAfterYears * 12) <= now;
  });
  for (const g of due) await prisma.$transaction((tx) => anonymizeGraduate(tx, ctx, g.id, "retention"));
  const auditCutoff = new Date(now.getTime() - cfg.auditLogDays * 86_400_000);
  const emailCutoff = new Date(now.getTime() - cfg.emailLogDays * 86_400_000);
  const [auditDeleted, emailsDeleted, sessionsDeleted] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { at: { lt: auditCutoff } } }),
    prisma.outboundEmail.deleteMany({ where: { updatedAt: { lt: emailCutoff }, state: { in: ["sent", "suppressed", "dead"] } } }),
    prisma.session.deleteMany({ where: { expires: { lt: now } } }),
  ]);
  const result = { anonymized: due.length, auditDeleted: auditDeleted.count, emailsDeleted: emailsDeleted.count, sessionsDeleted: sessionsDeleted.count };
  if (result.anonymized || result.auditDeleted) await audit(prisma, ctx, { action: "retention.run", entityType: "System", meta: result });
  return result;
}
