import { planSurveys, nextReminderDue, shouldSkipForRecentUpdate, type SurveyStatus } from "@/domain/scheduling/surveys";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { requirePermission, systemContext, type RequestContext } from "../context";
import { NotFoundError } from "../errors";
import { enqueueEmail, processOutbox } from "../outbox";
import { getSetting } from "../settings";

/**
 * (Re)plans the four milestone surveys for each graduate from their effective graduation
 * date. Idempotent: running it twice changes nothing; never creates duplicates
 * (also enforced by the unique (graduateId, milestone) constraint).
 */
export async function scheduleSurveysForGraduates(db: Db, graduateIds: readonly string[], now = new Date()) {
  if (graduateIds.length === 0) return { created: 0, updated: 0 };
  const cfg = await getSetting("surveys", db);
  const grads = await db.graduate.findMany({
    where: { id: { in: [...graduateIds] } },
    select: { id: true, anonymizedAt: true, graduationDateOverride: true, cohort: { select: { graduationDate: true } }, surveys: { select: { id: true, milestone: true, status: true, scheduledFor: true, catchUp: true } } },
  });
  let created = 0;
  let updated = 0;
  for (const g of grads) {
    const gradDate = g.anonymizedAt ? null : g.graduationDateOverride ?? g.cohort.graduationDate;
    const plan = planSurveys(gradDate, g.surveys.map((s) => ({ ...s, status: s.status as SurveyStatus })), now, cfg);
    const creates = plan.flatMap((a) => (a.type === "create" ? [{ graduateId: g.id, milestone: a.milestone, scheduledFor: a.scheduledFor, status: a.status, catchUp: a.catchUp ?? false }] : []));
    if (creates.length) created += (await db.surveyInstance.createMany({ data: creates, skipDuplicates: true })).count;
    for (const a of plan) {
      if (a.type !== "update") continue;
      // Only touch rows that are still unsent at write time (guards against a concurrent send).
      const r = await db.surveyInstance.updateMany({ where: { id: a.id, status: { in: ["scheduled", "missed", "cancelled"] } }, data: { scheduledFor: a.scheduledFor, status: a.status, ...(a.catchUp ? { catchUp: true } : {}) } });
      updated += r.count;
    }
  }
  return { created, updated };
}

export async function scheduleSurveysForCohort(db: Db, cohortId: string, now = new Date()) {
  const ids = (await db.graduate.findMany({ where: { cohortId }, select: { id: true } })).map((g) => g.id);
  return scheduleSurveysForGraduates(db, ids, now);
}

/**
 * Periodic job: queue due surveys, queue due reminders, then drain the outbox.
 * Safe to run concurrently and repeatedly (idempotency keys + conditional updates).
 */
export async function runSurveyTick(now = new Date()) {
  const { applyGraduationDefaults } = await import("./graduation");
  await applyGraduationDefaults(now);
  const cfg = await getSetting("surveys");
  const ctx = systemContext("survey-tick");
  const stats = { queued: 0, skipped: 0, cancelled: 0, reminders: 0 };

  const due = await prisma.surveyInstance.findMany({
    where: { status: "scheduled", scheduledFor: { lte: now } },
    take: 500,
    orderBy: { scheduledFor: "asc" },
    include: { graduate: { select: { anonymizedAt: true, unsubscribedAt: true, emailEnc: true, lastSelfUpdateAt: true } } },
  });
  for (const s of due) {
    const g = s.graduate;
    if (g.anonymizedAt || g.unsubscribedAt || !g.emailEnc) {
      stats.cancelled += (await prisma.surveyInstance.updateMany({ where: { id: s.id, status: "scheduled" }, data: { status: "cancelled" } })).count;
      continue;
    }
    if (shouldSkipForRecentUpdate(g.lastSelfUpdateAt, now, cfg.skipWindowDays)) {
      stats.skipped += (await prisma.surveyInstance.updateMany({ where: { id: s.id, status: "scheduled" }, data: { status: "skipped_recent_update" } })).count;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const r = await tx.surveyInstance.updateMany({ where: { id: s.id, status: "scheduled" }, data: { status: "queued" } });
      if (r.count === 0) return; // another worker got it
      await enqueueEmail(tx, { idempotencyKey: `survey:${s.id}:initial`, graduateId: s.graduateId, kind: "survey_initial", payload: { surveyId: s.id, milestone: s.milestone, ...(s.catchUp ? { catchUp: true } : {}) }, sendAfter: now });
      stats.queued++;
    });
  }

  const awaiting = await prisma.surveyInstance.findMany({
    where: { status: "sent", completedAt: null, reminderCount: { lt: cfg.reminderOffsetsDays.length } },
    select: { id: true, graduateId: true, sentAt: true, reminderCount: true, milestone: true },
  });
  for (const s of awaiting) {
    const dueAt = nextReminderDue(s.sentAt, s.reminderCount, { offsetsDays: cfg.reminderOffsetsDays });
    if (!dueAt || dueAt > now) continue;
    const n = s.reminderCount + 1;
    const before = await prisma.outboundEmail.count({ where: { idempotencyKey: `survey:${s.id}:reminder:${n}` } });
    await enqueueEmail(prisma, { idempotencyKey: `survey:${s.id}:reminder:${n}`, graduateId: s.graduateId, kind: "survey_reminder", payload: { surveyId: s.id, milestone: s.milestone, reminderNumber: n }, sendAfter: now });
    if (before === 0) stats.reminders++;
  }

  const outbox = await processOutbox({ now });
  if (stats.queued || stats.reminders) await audit(prisma, ctx, { action: "survey.tick", entityType: "SurveyInstance", meta: { ...stats } });
  return { ...stats, outbox };
}

// ─── Staff views ─────────────────────────────────────────────

/**
 * Response rate = (completed + skipped because of a recent self-update) ÷ surveys that went out
 * (sent, completed, bounced, skipped). Scheduled/queued/missed/cancelled are not in the denominator.
 */
export async function surveyResponseStats(ctx: RequestContext) {
  requirePermission(ctx, "survey:read");
  const rows = await prisma.$queryRaw<{ cohort: string; cohortId: string; milestone: number; status: string; n: bigint }[]>`
    SELECT c.name AS cohort, c.id AS "cohortId", s.milestone, s.status::text AS status, COUNT(*) AS n
    FROM "SurveyInstance" s JOIN "Graduate" g ON g.id = s."graduateId" JOIN "Cohort" c ON c.id = g."cohortId"
    GROUP BY c.name, c.id, s.milestone, s.status`;
  type Cell = { eligible: number; responded: number; byStatus: Record<string, number> };
  const empty = (): Cell => ({ eligible: 0, responded: 0, byStatus: {} });
  const byMilestone = new Map<number, Cell>();
  const byCohort = new Map<string, Cell & { cohort: string }>();
  const totals = empty();
  for (const r of rows) {
    const n = Number(r.n);
    const eligible = ["sent", "completed", "bounced", "skipped_recent_update"].includes(r.status) ? n : 0;
    const responded = ["completed", "skipped_recent_update"].includes(r.status) ? n : 0;
    for (const cell of [
      byMilestone.get(r.milestone) ?? byMilestone.set(r.milestone, empty()).get(r.milestone)!,
      byCohort.get(r.cohortId) ?? byCohort.set(r.cohortId, { ...empty(), cohort: r.cohort }).get(r.cohortId)!,
      totals,
    ]) {
      cell.eligible += eligible;
      cell.responded += responded;
      cell.byStatus[r.status] = (cell.byStatus[r.status] ?? 0) + n;
    }
  }
  const rate = (c: Cell) => (c.eligible ? c.responded / c.eligible : null);
  return {
    totals: { ...totals, rate: rate(totals) },
    byMilestone: [...byMilestone].sort((a, b) => a[0] - b[0]).map(([milestone, c]) => ({ milestone, ...c, rate: rate(c) })),
    byCohort: [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => ({ ...c, rate: rate(c) })),
  };
}

export async function listDeadLetters(ctx: RequestContext) {
  requirePermission(ctx, "survey:manage");
  return prisma.outboundEmail.findMany({
    where: { state: { in: ["dead", "uncertain"] } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, kind: true, state: true, attempts: true, lastError: true, createdAt: true, updatedAt: true, graduate: { select: { id: true, fullName: true } } },
  });
}

/** Re-queues a failed email. For `uncertain` rows staff accept that it may arrive twice. */
export async function retryDeadLetter(ctx: RequestContext, id: string) {
  requirePermission(ctx, "survey:manage");
  const row = await prisma.outboundEmail.findUnique({ where: { id } });
  if (!row || !["dead", "uncertain"].includes(row.state)) throw new NotFoundError("Failed email");
  await prisma.outboundEmail.update({ where: { id }, data: { state: "pending", attempts: 0, sendAfter: new Date(), lastError: null } });
  if (row.kind === "survey_initial") {
    const surveyId = (row.payload as { surveyId?: string }).surveyId;
    if (surveyId) await prisma.surveyInstance.updateMany({ where: { id: surveyId, status: { in: ["bounced", "cancelled"] } }, data: { status: "queued" } });
  }
  await audit(prisma, ctx, { action: "email.retry", entityType: "OutboundEmail", entityId: id, meta: { previousState: row.state } });
}

/** Marks a failed email as handled without sending (e.g. delivery confirmed some other way). */
export async function dismissDeadLetter(ctx: RequestContext, id: string) {
  requirePermission(ctx, "survey:manage");
  const r = await prisma.outboundEmail.updateMany({ where: { id, state: { in: ["dead", "uncertain"] } }, data: { state: "suppressed", lastError: "Dismissed by staff" } });
  if (!r.count) throw new NotFoundError("Failed email");
  await audit(prisma, ctx, { action: "email.dismiss", entityType: "OutboundEmail", entityId: id });
}

/** Staff action: email the graduate a fresh personal link (the link itself is never shown to staff). */
export async function sendProfileLinkAsStaff(ctx: RequestContext, graduateId: string) {
  requirePermission(ctx, "graduate:rotate_link");
  const g = await prisma.graduate.findUnique({ where: { id: graduateId }, select: { id: true, anonymizedAt: true, emailEnc: true } });
  if (!g || g.anonymizedAt || !g.emailEnc) throw new NotFoundError("Graduate");
  const id = await enqueueEmail(prisma, { idempotencyKey: `link:staff:${graduateId}:${Date.now()}`, graduateId, kind: "profile_link" });
  await audit(prisma, ctx, { action: "graduate.send_link", entityType: "Graduate", entityId: graduateId, meta: { emailId: id } });
  const { deliverNow } = await import("../outbox");
  return deliverNow(id);
}
