/**
 * Transactional email outbox. Guarantees:
 *
 *  1. No duplicate enqueue: `idempotencyKey` is unique; enqueueing the same key twice is a no-op.
 *  2. No two workers send the same row: rows are claimed with UPDATE … FOR UPDATE SKIP LOCKED.
 *  3. No duplicate delivery after a crash:
 *       pending/failed ──claim──▶ sending ──provider ok──▶ sent
 *     A row left in `sending` (worker died mid-send) is recovered after LOCK_TIMEOUT:
 *       - provider supports idempotency keys (Resend, console): back to `failed` → retried;
 *         the provider de-duplicates on the same key, so the graduate gets one email.
 *       - provider without idempotency (SMTP): → `uncertain` and shown in the dead-letter view.
 *         It is never resent automatically ("at most once").
 *  4. Transient errors retry with exponential backoff; permanent errors (hard bounce) → `dead`.
 *  5. Unsubscribed / anonymized recipients are `suppressed`; survey and match emails respect
 *     quiet hours in the recipient's time zone.
 */
import type { Prisma } from "@prisma/client";
import { nextAllowedSendTime, safeTimeZone } from "@/domain/scheduling/quietHours";
import { prisma, type Db } from "./db";
import { decrypt, decryptOpt, encrypt } from "./crypto";
import { env } from "./env";
import { emailAdapter } from "./email/adapters";
import { renderTemplate, type TemplateName } from "./email/templates";
import { PermanentEmailError } from "./email/types";
import { graduateLink, unsubscribeLink } from "./tokens";
import { getSetting } from "./settings";
import { logger } from "./logger";

export const MAX_ATTEMPTS = 5;
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Kinds that are bulk/non-urgent: honour unsubscribe and quiet hours. */
const RESPECTS_UNSUBSCRIBE = new Set(["survey_initial", "survey_reminder", "match_notification"]);
const RESPECTS_QUIET_HOURS = RESPECTS_UNSUBSCRIBE;

export interface EnqueueInput {
  idempotencyKey: string;
  graduateId: string;
  kind: TemplateName;
  payload?: Record<string, unknown>;
  sendAfter?: Date;
}

/** Inserts the email unless the key already exists. Returns the row id (new or existing). */
export async function enqueueEmail(db: Db, e: EnqueueInput): Promise<string> {
  await db.outboundEmail.createMany({
    data: [{ idempotencyKey: e.idempotencyKey, graduateId: e.graduateId, kind: e.kind, template: e.kind, payload: (e.payload ?? {}) as Prisma.InputJsonValue, sendAfter: e.sendAfter ?? new Date() }],
    skipDuplicates: true,
  });
  const row = await db.outboundEmail.findUniqueOrThrow({ where: { idempotencyKey: e.idempotencyKey }, select: { id: true } });
  return row.id;
}

async function claim(limit: number, now: Date, id?: string): Promise<string[]> {
  const rows = id
    ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OutboundEmail" SET state = 'sending'::"EmailState", "lockedAt" = ${now}, attempts = attempts + 1, "updatedAt" = ${now}
        WHERE id = (SELECT id FROM "OutboundEmail" WHERE id = ${id} AND state IN ('pending','failed') AND "sendAfter" <= ${now} FOR UPDATE SKIP LOCKED)
        RETURNING id`
    : await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OutboundEmail" SET state = 'sending'::"EmailState", "lockedAt" = ${now}, attempts = attempts + 1, "updatedAt" = ${now}
        WHERE id IN (SELECT id FROM "OutboundEmail" WHERE state IN ('pending','failed') AND "sendAfter" <= ${now}
                     ORDER BY "sendAfter" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id`;
  return rows.map((r) => r.id);
}

/** Recovers rows stuck in `sending` (the worker crashed). Never resends via non-idempotent providers. */
export async function recoverStuck(now = new Date()): Promise<{ retried: number; uncertain: number }> {
  const cutoff = new Date(now.getTime() - LOCK_TIMEOUT_MS);
  const where = { state: "sending" as const, lockedAt: { lt: cutoff } };
  if (emailAdapter().supportsIdempotency) {
    const r = await prisma.outboundEmail.updateMany({ where, data: { state: "failed", lockedAt: null, lastError: "Recovered after worker interruption" } });
    return { retried: r.count, uncertain: 0 };
  }
  const r = await prisma.outboundEmail.updateMany({ where, data: { state: "uncertain", lockedAt: null, lastError: "Worker stopped during send; delivery unknown. Not resent automatically." } });
  if (r.count) logger.warn("outbox rows marked uncertain", { count: r.count });
  return { retried: 0, uncertain: r.count };
}

const scrubError = (e: unknown) => String(e instanceof Error ? `${e.name}: ${e.message}` : e).replace(/[^\s@"']+@[^\s@"']+/g, "[email]").slice(0, 300);

async function deliver(id: string, now: Date): Promise<"sent" | "deferred" | "suppressed" | "failed" | "dead"> {
  const row = await prisma.outboundEmail.findUniqueOrThrow({
    where: { id },
    include: { graduate: { select: { id: true, fullName: true, preferredName: true, emailEnc: true, timezone: true, unsubscribedAt: true, anonymizedAt: true, profileTokenVersion: true } } },
  });
  const g = row.graduate;
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  const suppress = async (reason: string) => {
    await prisma.outboundEmail.update({ where: { id }, data: { state: "suppressed", lockedAt: null, lastError: reason } });
    await afterFinal(row.kind, payload, "suppressed", now);
    return "suppressed" as const;
  };
  if (!g || g.anonymizedAt || !g.emailEnc) return suppress("No recipient");
  if (RESPECTS_UNSUBSCRIBE.has(row.kind) && g.unsubscribedAt) return suppress("Recipient unsubscribed");

  if (RESPECTS_QUIET_HOURS.has(row.kind)) {
    const { quietHours } = await getSetting("surveys");
    const at = nextAllowedSendTime(now, safeTimeZone(g.timezone, env().ACADEMY_TIMEZONE), quietHours);
    if (at.getTime() - now.getTime() > 60_000) {
      await prisma.outboundEmail.update({ where: { id }, data: { state: "pending", sendAfter: at, lockedAt: null, attempts: { decrement: 1 } } });
      return "deferred";
    }
  }

  const firstName = g.preferredName ?? g.fullName.split(" ")[0] ?? "there";
  const ctx = {
    firstName,
    milestone: typeof payload.milestone === "number" ? payload.milestone : undefined,
    link: graduateLink(g, { surveyId: typeof payload.surveyId === "string" ? payload.surveyId : undefined, matchId: typeof payload.matchId === "string" ? payload.matchId : undefined, now }),
    unsubscribeUrl: RESPECTS_UNSUBSCRIBE.has(row.kind) ? unsubscribeLink(g.id, now) : undefined,
    code: typeof payload.codeEnc === "string" ? decryptOpt(payload.codeEnc) ?? undefined : undefined,
    openingTitle: typeof payload.openingTitle === "string" ? payload.openingTitle : undefined,
    companyName: typeof payload.companyName === "string" ? payload.companyName : undefined,
    explanation: typeof payload.explanation === "string" ? payload.explanation : undefined,
  };
  const rendered = renderTemplate(row.kind as TemplateName, ctx);
  const headers: Record<string, string> = {};
  if (ctx.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${ctx.unsubscribeUrl.replace("/unsubscribe/", "/api/unsubscribe/")}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const res = await emailAdapter().send({ to: decrypt(g.emailEnc), ...rendered, idempotencyKey: row.idempotencyKey, headers });
    // Secrets (one-time codes) are wiped from the payload once delivered.
    const cleanPayload = { ...payload, codeEnc: undefined } as Prisma.InputJsonValue;
    await prisma.$transaction(async (tx) => {
      await tx.outboundEmail.update({ where: { id }, data: { state: "sent", sentAt: now, providerMessageId: res.providerMessageId, lockedAt: null, lastError: null, payload: cleanPayload } });
      await afterSent(tx, row.kind, payload, now);
    });
    return "sent";
  } catch (err) {
    const permanent = err instanceof PermanentEmailError;
    const dead = permanent || row.attempts >= MAX_ATTEMPTS;
    const backoffMs = Math.min(60, 2 ** row.attempts) * 60_000;
    await prisma.outboundEmail.update({
      where: { id },
      data: { state: dead ? "dead" : "failed", lockedAt: null, lastError: scrubError(err), sendAfter: dead ? row.sendAfter : new Date(now.getTime() + backoffMs) },
    });
    if (dead) await afterFinal(row.kind, payload, permanent ? "bounced" : "dead", now);
    logger.warn("email send failed", { emailId: id, kind: row.kind, attempt: row.attempts, dead, err: scrubError(err) });
    return dead ? "dead" : "failed";
  }
}

/** Side effects of a successful send, in the same transaction as marking the row sent. */
async function afterSent(tx: Db, kind: string, payload: Record<string, unknown>, now: Date) {
  const surveyId = typeof payload.surveyId === "string" ? payload.surveyId : null;
  if (!surveyId) return;
  if (kind === "survey_initial") {
    await tx.surveyInstance.updateMany({ where: { id: surveyId, status: "queued" }, data: { status: "sent", sentAt: now } });
  } else if (kind === "survey_reminder" && typeof payload.reminderNumber === "number") {
    await tx.surveyInstance.updateMany({ where: { id: surveyId, reminderCount: { lt: payload.reminderNumber } }, data: { reminderCount: payload.reminderNumber, lastReminderAt: now } });
  }
}

async function afterFinal(kind: string, payload: Record<string, unknown>, outcome: "bounced" | "dead" | "suppressed", _now: Date) {
  const surveyId = typeof payload.surveyId === "string" ? payload.surveyId : null;
  if (!surveyId || kind !== "survey_initial") return;
  await prisma.surveyInstance.updateMany({ where: { id: surveyId, status: "queued" }, data: { status: outcome === "bounced" ? "bounced" : "cancelled" } });
}

/** Drains due emails. Safe to run concurrently from several workers. */
export async function processOutbox(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const recovered = await recoverStuck(now);
  const ids = await claim(opts.limit ?? 50, now);
  const results: Record<string, number> = {};
  for (const id of ids) {
    const r = await deliver(id, now);
    results[r] = (results[r] ?? 0) + 1;
  }
  return { claimed: ids.length, ...results, ...recovered };
}

/** Sends one specific email right away (user-initiated: links, codes). Still goes through the claim. */
export async function deliverNow(id: string, now = new Date()) {
  const [claimed] = await claim(1, now, id);
  return claimed ? deliver(claimed, now) : "not_claimed";
}

/** Stores a one-time code encrypted in the payload; wiped after sending. */
export function otpPayload(code: string, purpose: string) {
  return { codeEnc: encrypt(code), purpose };
}
