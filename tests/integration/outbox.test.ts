import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { PermanentEmailError } from "@/server/email/types";
import { deliverNow, enqueueEmail, LOCK_TIMEOUT_MS, otpPayload, processOutbox } from "@/server/outbox";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, makeGraduate, resetDb } from "./helpers";

const NOON = new Date("2026-05-01T12:00:00Z");

describe("email outbox", () => {
  let fake: FakeEmailAdapter;
  let gradId: string;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter(true);
    setEmailAdapter(fake);
    const g = await makeGraduate((await makeCohort()).id, { email: "ani@example.test" });
    await prisma.graduate.update({ where: { id: g.id }, data: { timezone: "UTC" } });
    gradId = g.id;
  });
  afterEach(() => setEmailAdapter(undefined));

  it("enqueueing the same key twice creates one email, delivered once", async () => {
    await enqueueEmail(prisma, { idempotencyKey: "k1", graduateId: gradId, kind: "profile_link", sendAfter: NOON });
    await enqueueEmail(prisma, { idempotencyKey: "k1", graduateId: gradId, kind: "profile_link", sendAfter: NOON });
    expect(await prisma.outboundEmail.count()).toBe(1);
    await processOutbox({ now: NOON });
    await processOutbox({ now: NOON });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("ani@example.test");
    expect(fake.sent[0]!.text).toMatch(/\/u\/[\w-]+\.[\w-]+/); // fresh personal link
  });

  it("concurrent workers never send the same email twice", async () => {
    for (let i = 0; i < 20; i++) await enqueueEmail(prisma, { idempotencyKey: `c${i}`, graduateId: gradId, kind: "profile_link", sendAfter: NOON });
    const noDedupe = new FakeEmailAdapter(false);
    setEmailAdapter(noDedupe);
    await Promise.all([processOutbox({ now: NOON, limit: 7 }), processOutbox({ now: NOON, limit: 7 }), processOutbox({ now: NOON, limit: 7 })]);
    await processOutbox({ now: NOON });
    expect(noDedupe.sent).toHaveLength(20);
    expect(new Set(noDedupe.sent.map((m) => m.idempotencyKey)).size).toBe(20);
  });

  it("a crash mid-send with a non-idempotent provider (SMTP) is marked uncertain and NOT resent", async () => {
    const smtp = new FakeEmailAdapter(false);
    setEmailAdapter(smtp);
    const id = await enqueueEmail(prisma, { idempotencyKey: "crash", graduateId: gradId, kind: "profile_link", sendAfter: NOON });
    // Simulate: worker claimed the row, handed it to SMTP, then died before marking it sent.
    await prisma.outboundEmail.update({ where: { id }, data: { state: "sending", lockedAt: new Date(NOON.getTime() - LOCK_TIMEOUT_MS - 1000), attempts: 1 } });
    const r = await processOutbox({ now: NOON });
    expect(r.uncertain).toBe(1);
    expect(smtp.sent).toHaveLength(0);
    expect((await prisma.outboundEmail.findUniqueOrThrow({ where: { id } })).state).toBe("uncertain");
  });

  it("a crash with an idempotent provider is retried, and the provider de-duplicates", async () => {
    const id = await enqueueEmail(prisma, { idempotencyKey: "crash2", graduateId: gradId, kind: "profile_link", sendAfter: NOON });
    fake.accepted.add("crash2"); // the provider DID receive it before the crash
    await prisma.outboundEmail.update({ where: { id }, data: { state: "sending", lockedAt: new Date(NOON.getTime() - LOCK_TIMEOUT_MS - 1000), attempts: 1 } });
    await processOutbox({ now: NOON });
    expect(fake.sent).toHaveLength(0); // no second delivery
    expect((await prisma.outboundEmail.findUniqueOrThrow({ where: { id } })).state).toBe("sent");
  });

  it("retries transient errors with backoff, then succeeds", async () => {
    fake.failures.push(new Error("ECONNRESET"));
    const id = await enqueueEmail(prisma, { idempotencyKey: "t", graduateId: gradId, kind: "profile_link", sendAfter: NOON });
    await processOutbox({ now: NOON });
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("failed");
    expect(row.sendAfter > NOON).toBe(true);
    await processOutbox({ now: NOON }); // not due yet
    expect(fake.sent).toHaveLength(0);
    await processOutbox({ now: new Date(row.sendAfter.getTime() + 1000) });
    expect(fake.sent).toHaveLength(1);
  });

  it("a hard bounce goes to the dead-letter queue and marks the survey bounced", async () => {
    const survey = await prisma.surveyInstance.create({ data: { graduateId: gradId, milestone: 1, scheduledFor: NOON, status: "queued" } });
    fake.failures.push(new PermanentEmailError("550 mailbox unavailable for ani@example.test"));
    const id = await enqueueEmail(prisma, { idempotencyKey: "b", graduateId: gradId, kind: "survey_initial", payload: { surveyId: survey.id, milestone: 1 }, sendAfter: NOON });
    await processOutbox({ now: NOON });
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("dead");
    expect(row.lastError).not.toContain("ani@example.test"); // no personal data in stored errors
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: survey.id } })).status).toBe("bounced");
  });

  it("defers survey emails during quiet hours in the graduate's time zone", async () => {
    const id = await enqueueEmail(prisma, { idempotencyKey: "q", graduateId: gradId, kind: "survey_reminder", payload: {}, sendAfter: NOON });
    const late = new Date("2026-05-01T23:30:00Z");
    await processOutbox({ now: late });
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("pending");
    expect(row.sendAfter.toISOString()).toBe("2026-05-02T08:00:00.000Z");
    expect(fake.sent).toHaveLength(0);
  });

  it("does not defer user-requested emails (codes, links) for quiet hours", async () => {
    const id = await enqueueEmail(prisma, { idempotencyKey: "otp", graduateId: gradId, kind: "otp", payload: otpPayload("123456", "change_email"), sendAfter: NOON });
    await deliverNow(id, new Date("2026-05-01T23:30:00Z"));
    expect(fake.sent[0]!.text).toContain("123456");
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(row.payload)).not.toContain("codeEnc"); // secret wiped after send
  });

  it("suppresses survey emails to unsubscribed graduates and cancels the survey", async () => {
    await prisma.graduate.update({ where: { id: gradId }, data: { unsubscribedAt: new Date() } });
    const survey = await prisma.surveyInstance.create({ data: { graduateId: gradId, milestone: 3, scheduledFor: NOON, status: "queued" } });
    await enqueueEmail(prisma, { idempotencyKey: "u", graduateId: gradId, kind: "survey_initial", payload: { surveyId: survey.id, milestone: 3 }, sendAfter: NOON });
    await processOutbox({ now: NOON });
    expect(fake.sent).toHaveLength(0);
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: survey.id } })).status).toBe("cancelled");
  });

  it("adds one-click unsubscribe headers to survey emails", async () => {
    const survey = await prisma.surveyInstance.create({ data: { graduateId: gradId, milestone: 1, scheduledFor: NOON, status: "queued" } });
    await enqueueEmail(prisma, { idempotencyKey: "h", graduateId: gradId, kind: "survey_initial", payload: { surveyId: survey.id, milestone: 1 }, sendAfter: NOON });
    await processOutbox({ now: NOON });
    expect(fake.sent[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(fake.sent[0]!.subject).toContain("1-month");
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: survey.id } })).status).toBe("sent");
  });
});
