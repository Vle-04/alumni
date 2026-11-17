/**
 * Audit item 2: after deleting a graduate, their name and email exist NOWHERE — audit diffs, the
 * email queue (addresses and rendered bodies are never stored; payloads are cleared), pg-boss
 * jobs/archive, referral notes, partner disclosure records, rate-limit keys… Every text/json/array
 * column of every table in every schema is searched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import PgBoss from "pg-boss";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { blindIndex } from "@/server/crypto";
import { processOutbox } from "@/server/outbox";
import { createGraduate, revealContact, updateGraduate } from "@/server/services/graduates";
import { requestNewLink, requestOtp, submitSelfUpdate, submitSurvey } from "@/server/services/self-service";
import { notifyGraduate, moveReferral, respondToMatch } from "@/server/services/placement";
import { partnerDashboard } from "@/server/services/partner";
import { setConsent } from "@/server/services/consent";
import { deleteMyAccount } from "@/server/services/privacy";
import { runSurveyTick } from "@/server/services/surveys";
import { encrypt } from "@/server/crypto";
import { JOBS } from "@/worker/jobs";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, resetDb, staff } from "./helpers";

const NAME = "Zebulon Quibbleworth";
const NEW_NAME = "Zebulon Q. Quibbleworth";
const EMAIL = "zebulon.quibbleworth@example.test";
const PHONE = "+1 555 0199";

async function searchEverywhere(needles: string[]) {
  const cols = await prisma.$queryRaw<{ table_schema: string; table_name: string; column_name: string }[]>`
    SELECT table_schema, table_name, column_name FROM information_schema.columns
    WHERE table_schema IN ('public', 'pgboss') AND table_name <> '_prisma_migrations'
      AND (data_type IN ('text', 'character varying', 'json', 'jsonb') OR data_type = 'ARRAY' OR data_type = 'USER-DEFINED')`;
  const hits: string[] = [];
  for (const c of cols) {
    for (const n of needles) {
      const sql = `SELECT count(*)::int AS n FROM "${c.table_schema}"."${c.table_name}" WHERE "${c.column_name}"::text ILIKE $1`;
      const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(sql, `%${n}%`);
      const count = rows[0]?.n ?? 0;
      if (count > 0) hits.push(`${c.table_schema}.${c.table_name}.${c.column_name} contains "${n}" (${count}×)`);
    }
  }
  return { hits, columnsSearched: cols.length };
}

describe("deletion leaves no trace of name or email", () => {
  let fake: FakeEmailAdapter;
  let boss: PgBoss;
  beforeAll(async () => {
    await resetDb();
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
    await boss.start();
  });
  afterAll(async () => { await boss.stop({ graceful: false }); });
  afterEach(() => setEmailAdapter(undefined));

  it("searches every table and finds nothing after deletion", async () => {
    fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
    const cs = await staff("CAREER_SERVICES");
    const cohort = await makeCohort({ graduationDate: new Date(Date.now() - 40 * 86_400_000) });
    const company = await prisma.company.create({ data: { canonicalName: "Sweep Partner", isPartner: true } });
    const contact = await prisma.partnerContact.create({ data: { companyId: company.id, name: "Pat Partner", emailEnc: encrypt("pat@partner.test"), emailHash: blindIndex("pat@partner.test") } });

    // 1. Staff create and rename the graduate (audit diffs), and view contact details (audit).
    const id = await createGraduate(cs, { fullName: NAME, email: EMAIL, phone: PHONE, cohortId: cohort.id, skills: [{ name: "Python", level: 4 }] });
    await updateGraduate(cs, id, { fullName: NEW_NAME, email: EMAIL, phone: PHONE, cohortId: cohort.id, skills: [{ name: "Python", level: 4 }] });
    await revealContact(cs, id);
    const g = { actor: { type: "graduate" as const, id }, ip: "203.0.113.7", userAgent: "Zebulon's phone" };

    // 2. Survey email goes through the outbox; graduate answers; codes and links are emailed.
    await prisma.surveyInstance.updateMany({ where: { graduateId: id, milestone: 1 }, data: { scheduledFor: new Date(Date.now() - 3600_000), status: "scheduled" } });
    await runSurveyTick();
    const survey = await prisma.surveyInstance.findFirstOrThrow({ where: { graduateId: id, milestone: 1 } });
    await submitSurvey(g, survey.id, { mode: "update", status: "searching", blockers: ["interviews"] });
    await submitSelfUpdate(g, { mode: "update", status: "searching", helpWanted: ["cv_review"] });
    await requestNewLink(EMAIL, "203.0.113.7");
    await requestOtp(g, "change_email");

    // 3. Placement: notification, interest, referral with staff notes, partner disclosure.
    for (const p of ["job_matching", "share_with_partners"] as const) await setConsent(prisma, g, id, p, true, "self_update");
    const opening = await prisma.opening.create({ data: { companyId: company.id, title: "Analyst", description: "Analyse data", status: "open", remoteMode: "remote" } });
    const matchId = await notifyGraduate(cs, opening.id, id);
    await respondToMatch(g, matchId, "interested");
    const ref = await prisma.referral.findFirstOrThrow({ where: { graduateId: id } });
    await prisma.referral.update({ where: { id: ref.id }, data: { notes: `Spoke to ${NAME} at ${EMAIL}` } });
    await moveReferral(cs, ref.id, "referred", `${NAME} sent CV`);
    await partnerDashboard({ actor: { type: "partner", id: contact.id, companyId: company.id } });
    await processOutbox();

    // 4. Background jobs ran through pg-boss (same payloads the worker uses).
    for (const j of JOBS) await boss.createQueue(j.name);
    for (const j of JOBS) await boss.send(j.name, {});
    for (const j of JOBS) {
      const [job] = await boss.fetch(j.name);
      if (job) await boss.complete(j.name, job.id);
    }

    // Sanity: before deletion the needles really are present somewhere.
    const before = await searchEverywhere([NAME, "Quibbleworth", EMAIL]);
    expect(before.hits.length).toBeGreaterThan(0);
    expect(fake.sent.length).toBeGreaterThan(0);

    // 5. Delete (by the graduate, with a one-time code).
    await requestOtp({ ...g }, "delete_account").catch(() => undefined); // may hit the 3/15 min limit…
    const otp = await prisma.oneTimeCode.findFirst({ where: { graduateId: id, purpose: "delete_account", consumedAt: null } });
    if (!otp) await prisma.rateLimitBucket.deleteMany({ where: { key: `otp:${id}` } });
    if (!otp) await requestOtp(g, "delete_account");
    const code = /\b(\d{6})\b/.exec(fake.sent.at(-1)!.text)![1]!;
    await deleteMyAccount(g, code);

    // 6. Search every column of every table.
    const after = await searchEverywhere([NAME, NEW_NAME, "Quibbleworth", "Zebulon", EMAIL, "zebulon.quibbleworth", PHONE, blindIndex(EMAIL), blindIndex(EMAIL).slice(0, 24), "203.0.113.7", "Zebulon's phone"]);
    expect(after.columnsSearched).toBeGreaterThan(100);
    expect(after.hits).toEqual([]);

    // Partner-disclosure and contact-read audit entries still exist (as evidence) — just without personal data.
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "contact.read" } })).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
