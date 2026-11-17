import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestContext } from "@/server/context";
import { decrypt } from "@/server/crypto";
import * as self from "@/server/services/self-service";
import { hasConsent } from "@/server/services/consent";
import { rotateProfileLink } from "@/server/services/graduates";
import { createGraduateToken, createSessionValue, resolveGraduateToken } from "@/server/tokens";
import { signToken } from "@/domain/tokens/signedToken";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

describe("graduate self-service", () => {
  let fake: FakeEmailAdapter;
  let g: Awaited<ReturnType<typeof makeGraduate>>;
  let ctx: RequestContext;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
    g = await makeGraduate((await makeCohort()).id, { email: "ani@example.test" });
    ctx = { actor: { type: "graduate", id: g.id } };
  });
  afterEach(() => setEmailAdapter(undefined));

  const sentSurvey = () => prisma.surveyInstance.create({ data: { graduateId: g.id, milestone: 6, scheduledFor: new Date(), status: "sent", sentAt: new Date() } });

  it("answers a survey once: creates a record, completes the survey, rejects a second submit", async () => {
    const s = await sentSurvey();
    await self.submitSurvey(ctx, s.id, { mode: "update", status: "employed_full_time", companyName: "Acme LLC", roleTitle: "Junior Dev", startMonth: "2026-03", inField: "yes", openToOffers: "no" });
    const rec = await prisma.employmentRecord.findFirstOrThrow({ where: { graduateId: g.id }, include: { company: true } });
    expect(rec).toMatchObject({ status: "employed_full_time", source: "survey_6m", surveyInstanceId: s.id, roleTitle: "Junior Dev", inField: true });
    expect(rec.company?.canonicalName).toBe("Acme LLC");
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("completed");
    await expect(self.submitSurvey(ctx, s.id, { mode: "unchanged" })).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.employmentRecord.count()).toBe(1);
  });

  it("'Yes, nothing changed' copies the last record as a new history entry", async () => {
    await self.submitSelfUpdate(ctx, { mode: "update", status: "employed_full_time", companyName: "Acme", roleTitle: "Dev" });
    const s = await sentSurvey();
    await self.submitSurvey(ctx, s.id, { mode: "unchanged" });
    const recs = await prisma.employmentRecord.findMany({ where: { graduateId: g.id }, orderBy: { reportedAt: "asc" } });
    expect(recs).toHaveLength(2);
    expect(recs[1]).toMatchObject({ status: "employed_full_time", roleTitle: "Dev", companyId: recs[0]!.companyId, source: "survey_6m" });
  });

  it("cannot answer another graduate's survey", async () => {
    const other = await makeGraduate(g.cohortId);
    const s = await prisma.surveyInstance.create({ data: { graduateId: other.id, milestone: 1, scheduledFor: new Date(), status: "sent" } });
    await expect(self.submitSurvey(ctx, s.id, { mode: "update", status: "searching" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("self-update records the time (used to skip the next survey) and the job-search status", async () => {
    await self.submitSelfUpdate(ctx, { mode: "update", status: "searching", blockers: ["interviews"], helpWanted: "mock_interview" });
    const grad = await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } });
    expect(grad.lastSelfUpdateAt).not.toBeNull();
    expect(grad.currentStatus).toBe("searching");
    expect(grad.jobSearchStatus).toBe("active");
    const rec = await prisma.employmentRecord.findFirstOrThrow({ where: { graduateId: g.id } });
    expect(rec.helpWanted).toEqual(["mock_interview"]);
  });

  it("consent revocation takes effect immediately", async () => {
    await self.updateConsents(ctx, { job_matching: true, share_with_partners: true });
    expect(await hasConsent(prisma, g.id, "share_with_partners")).toBe(true);
    await self.updateConsents(ctx, { share_with_partners: false });
    expect(await hasConsent(prisma, g.id, "share_with_partners")).toBe(false);
    expect(await hasConsent(prisma, g.id, "job_matching")).toBe(true);
    const rows = await prisma.consent.findMany({ where: { graduateId: g.id, purpose: "share_with_partners" } });
    expect(rows[0]!.revokedAt).not.toBeNull(); // history kept
  });

  it("changing email requires a one-time code sent to the email on file", async () => {
    await self.requestOtp(ctx, "change_email");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("ani@example.test");
    const code = /\b(\d{6})\b/.exec(fake.sent[0]!.text)![1]!;
    await expect(self.changeEmail(ctx, { code: "000000" === code ? "111111" : "000000", newEmail: "new@example.test" })).rejects.toBeInstanceOf(ValidationError);
    await self.changeEmail(ctx, { code, newEmail: "New@Example.test" });
    const grad = await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } });
    expect(decrypt(grad.emailEnc!)).toBe("new@example.test");
    await expect(self.changeEmail(ctx, { code, newEmail: "again@example.test" })).rejects.toBeInstanceOf(ValidationError); // single use
  });

  it("locks a code after 5 wrong attempts", async () => {
    await self.requestOtp(ctx, "change_email");
    const code = /\b(\d{6})\b/.exec(fake.sent[0]!.text)![1]!;
    const wrong = code === "999999" ? "999998" : "999999";
    for (let i = 0; i < 5; i++) await expect(self.changeEmail(ctx, { code: wrong, newEmail: "x@example.test" })).rejects.toBeInstanceOf(ValidationError);
    await expect(self.changeEmail(ctx, { code, newEmail: "x@example.test" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("requesting a new link never reveals whether an email exists", async () => {
    expect(await self.requestNewLink("nobody@example.test", "1.1.1.1")).toBe("ok");
    expect(fake.sent).toHaveLength(0);
    expect(await self.requestNewLink("ANI@example.test", "1.1.1.1")).toBe("ok");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.text).toMatch(/\/u\//);
  });

  it("rate-limits new-link requests per IP", async () => {
    for (let i = 0; i < 10; i++) await self.requestNewLink(`x${i}@example.test`, "9.9.9.9");
    expect(await self.requestNewLink("ani@example.test", "9.9.9.9")).toBe("rate_limited");
  });

  it("staff cannot call graduate self-service functions", async () => {
    const cs = await staff("CAREER_SERVICES");
    await expect(self.submitSelfUpdate(cs, { mode: "unchanged" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("personal links", () => {
  beforeEach(resetDb);

  it("accepts a current link, rejects it after rotation, and rejects expired or forged links", async () => {
    const cs = await staff("CAREER_SERVICES");
    const g = await makeGraduate((await makeCohort()).id);
    const token = createGraduateToken(g, "profile");
    expect(await resolveGraduateToken(token, ["profile"])).toMatchObject({ ok: true, graduateId: g.id });

    const session = createSessionValue(g);
    await rotateProfileLink(cs, g.id);
    expect(await resolveGraduateToken(token, ["profile"])).toEqual({ ok: false, reason: "revoked" });
    expect(await resolveGraduateToken(session, ["session"])).toEqual({ ok: false, reason: "revoked" }); // open sessions end too

    const expired = signToken({ sub: g.id, v: 2, p: "profile", exp: Math.floor(Date.now() / 1000) - 1 }, process.env.TOKEN_SIGNING_KEY!);
    expect(await resolveGraduateToken(expired, ["profile"])).toEqual({ ok: false, reason: "expired" });
    const forged = signToken({ sub: g.id, v: 2, p: "profile", exp: Math.floor(Date.now() / 1000) + 99 }, "not-the-key");
    expect(await resolveGraduateToken(forged, ["profile"])).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveGraduateToken(token, ["session"])).toEqual({ ok: false, reason: "invalid" }); // link ≠ session
  });
});
