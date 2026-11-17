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
import { getOutcomesReport } from "@/server/services/reports";
import { makeCohort, resetDb, staff } from "./helpers";

const NAME = "Zebulon Quibbleworth";
const NEW_NAME = "Zebulon Q. Quibbleworth";
const EMAIL = "zebulon.quibbleworth@example.test";
const PHONE = "+1 555 0199";

/** Ciphertext format written by src/server/crypto.ts: v<N>.<iv 16>.<tag 22>.<ciphertext> (base64url). */
const CIPHERTEXT = /\bv\d+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+/g;

/**
 * AUDIT 16: find EVERY encrypted value in the database — any text/json/array column of any table,
 * discovered from information_schema (so new encrypted columns are covered automatically) — decrypt
 * it, and search the plaintext.
 */
async function searchDecrypted(needles: string[]) {
  const { decrypt } = await import("@/server/crypto");
  const cols = await textColumns();
  const hits: string[] = [];
  let decrypted = 0;
  for (const c of cols) {
    const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(`SELECT "${c.column_name}"::text AS v FROM "${c.table_schema}"."${c.table_name}" WHERE "${c.column_name}"::text ~ 'v[0-9]+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.'`);
    for (const r of rows) {
      for (const ct of r.v.match(CIPHERTEXT) ?? []) {
        let plain: string;
        try { plain = decrypt(ct); } catch { continue; }
        decrypted++;
        for (const n of needles) if (plain.toLowerCase().includes(n.toLowerCase())) hits.push(`${c.table_schema}.${c.table_name}.${c.column_name} decrypts to something containing "${n}"`);
      }
    }
  }
  return { hits, decrypted };
}

async function textColumns() {
  return prisma.$queryRaw<{ table_schema: string; table_name: string; column_name: string }[]>`
    SELECT table_schema, table_name, column_name FROM information_schema.columns
    WHERE table_schema IN ('public', 'pgboss') AND table_name <> '_prisma_migrations'
      AND (data_type IN ('text', 'character varying', 'json', 'jsonb') OR data_type = 'ARRAY' OR data_type = 'USER-DEFINED')`;
}

async function searchEverywhere(needles: string[]) {
  const cols = await textColumns();
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
    // AUDIT 21: the name typed into free text — a job title and a company name they typed.
    await submitSelfUpdate(g, { mode: "update", status: "freelance_contract", companyName: "Quibbleworth Consulting", roleTitle: `Founder (${NAME})`, startMonth: "2025-01", openToOffers: "yes" });
    await submitSelfUpdate(g, { mode: "update", status: "searching", helpWanted: ["cv_review"] });
    await requestNewLink(EMAIL, "203.0.113.7");
    await requestOtp(g, "change_email");

    // 3. Placement: notification, interest, referral with staff notes, partner disclosure.
    for (const p of ["job_matching", "share_with_partners"] as const) await setConsent(prisma, g, id, p, true, "self_update");
    // …and in an opening description staff wrote with them in mind.
    const opening = await prisma.opening.create({ data: { companyId: company.id, title: "Analyst", description: `Analyse data. Ideal for ${NAME}, contact ${EMAIL}.`, status: "open", remoteMode: "remote" } });
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

    // Sanity: before deletion the needles really are present — in plaintext AND in encrypted columns.
    const before = await searchEverywhere([NAME, "Quibbleworth", EMAIL]);
    expect(before.hits.length).toBeGreaterThan(0);
    expect((await searchDecrypted([EMAIL, PHONE])).hits.length).toBeGreaterThan(0);
    expect(fake.sent.length).toBeGreaterThan(0);
    await setConsent(prisma, g, id, "outcomes_reporting", true, "self_update");
    const reportNow = new Date(Date.now() + 400 * 86_400_000);
    const reportBefore = (await getOutcomesReport(cs, {}, reportNow)).report;

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

    // AUDIT 16: no encrypted copy either.
    const dec = await searchDecrypted([NAME, "Quibbleworth", "Zebulon", EMAIL, PHONE]);
    expect(dec.decrypted).toBeGreaterThan(0); // e.g. the partner contact's email — the scan did run
    expect(dec.hits).toEqual([]);

    // AUDIT 21: structured fields are intact and the outcomes report is identical.
    const recs = await prisma.employmentRecord.findMany({ where: { graduateId: id }, orderBy: { reportedAt: "asc" } });
    const freelance = recs.find((r) => r.status === "freelance_contract")!;
    expect(freelance.roleTitle).toMatch(/^Founder \(\[removed\]( \[removed\])?\)$/);
    expect(freelance).toMatchObject({ status: "freelance_contract", companyId: expect.any(String), startDate: new Date("2025-01-01T00:00:00Z") });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: recs.find((r) => r.companyId)!.companyId! } })).canonicalName).toBe("[removed] Consulting");
    expect((await prisma.opening.findUniqueOrThrow({ where: { id: opening.id } })).description).toMatch(/^Analyse data\. Ideal for \[removed\]( \[removed\])?, contact \[removed\]\.$/);
    const { generatedAt: _a, ...rb } = reportBefore;
    const { generatedAt: _b, ...ra } = (await getOutcomesReport(cs, {}, reportNow)).report;
    expect(ra).toEqual(rb);

    // Partner-disclosure and contact-read audit entries still exist (as evidence) — just without personal data.
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "contact.read" } })).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
