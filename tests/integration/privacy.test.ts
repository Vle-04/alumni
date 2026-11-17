import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { ForbiddenError, ValidationError } from "@/server/errors";
import type { RequestContext } from "@/server/context";
import { encrypt, blindIndex } from "@/server/crypto";
import { deleteGraduateAsStaff, deleteMyAccount, exportMyData, runRetention } from "@/server/services/privacy";
import { requestOtp } from "@/server/services/self-service";
import { getOutcomesReport } from "@/server/services/reports";
import { setConsent } from "@/server/services/consent";
import { updateSettings } from "@/server/services/settings-admin";
import { createGraduateToken, resolveGraduateToken } from "@/server/tokens";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const sys = { actor: { type: "system" as const, id: "test" } };

async function population() {
  const cohort = await makeCohort({ name: "Privacy Cohort", graduationDate: D("2025-01-31") });
  const company = await prisma.company.create({ data: { canonicalName: "Acme Corp", isPartner: true } });
  const grads = [];
  for (let i = 0; i < 12; i++) {
    const g = await makeGraduate(cohort.id, { name: `Real Person${i}`, email: `person${i}@example.test` });
    await prisma.graduate.update({ where: { id: g.id }, data: { phoneEnc: encrypt("+1 555 0100"), linkedinUrlEnc: encrypt("https://www.linkedin.com/in/p"), city: "Berlin" } });
    await setConsent(prisma, sys, g.id, "outcomes_reporting", true, "test");
    await prisma.employmentRecord.create({ data: { graduateId: g.id, status: i < 8 ? "employed_full_time" : "searching", companyId: i < 8 ? company.id : null, startDate: i < 8 ? D("2025-03-15") : null, reportedAt: D("2025-07-20"), source: "survey_6m" } });
    grads.push(g);
  }
  return grads;
}

describe("privacy: deletion, export, retention", () => {
  let fake: FakeEmailAdapter;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
  });
  afterEach(() => setEmailAdapter(undefined));
  const codeFrom = () => /\b(\d{6})\b/.exec(fake.sent.at(-1)!.text)![1]!;

  it("ACCEPTANCE: deleting a graduate removes personal data while aggregate numbers stay unchanged", async () => {
    const grads = await population();
    const victim = grads[0]!;
    const mk = await staff("LEADERSHIP");
    const NOW = D("2026-11-01");
    const before = (await getOutcomesReport(mk, {}, NOW)).report;

    const ctx: RequestContext = { actor: { type: "graduate", id: victim.id } };
    await requestOtp(ctx, "delete_account");
    await deleteMyAccount(ctx, codeFrom());

    const after = (await getOutcomesReport(mk, {}, NOW)).report;
    const { generatedAt: _a, ...b } = before;
    const { generatedAt: _b, ...a } = after;
    expect(a).toEqual(b);

    const row = await prisma.graduate.findUniqueOrThrow({ where: { id: victim.id }, include: { skills: true } });
    expect(row).toMatchObject({ emailEnc: null, emailHash: null, phoneEnc: null, linkedinUrlEnc: null, city: null, preferredName: null });
    expect(row.fullName).toMatch(/^Deleted graduate #[0-9a-f]{8}$/);
    expect(row.anonymizedAt).not.toBeNull();
    expect(row.skills).toEqual([]);
    const dump = JSON.stringify(await prisma.$queryRaw`SELECT * FROM "Graduate" WHERE id = ${victim.id}`);
    expect(dump).not.toMatch(/Real Person0|person0@/);
    // Old links stop working, and the email can be reused by a new record.
    expect((await resolveGraduateToken(createGraduateToken({ id: victim.id, profileTokenVersion: 1 }, "profile"), ["profile"])).ok).toBe(false);
    expect(await prisma.graduate.findUnique({ where: { emailHash: blindIndex("person0@example.test") } })).toBeNull();
    // The audit log holds no personal data about the deletion either.
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: victim.id } }))).not.toMatch(/Real Person|@example\.test/);
  });

  it("deletion and export need a valid one-time code sent to the email on file", async () => {
    const [g] = await population();
    const ctx: RequestContext = { actor: { type: "graduate", id: g!.id } };
    await expect(deleteMyAccount(ctx, "123456")).rejects.toBeInstanceOf(ValidationError);
    await requestOtp(ctx, "export_data");
    expect(fake.sent.at(-1)!.to).toBe("person0@example.test");
    await expect(deleteMyAccount(ctx, codeFrom())).rejects.toBeInstanceOf(ValidationError); // code is purpose-bound
    await requestOtp(ctx, "export_data");
    const data = await exportMyData(ctx, codeFrom());
    expect(data.profile).toMatchObject({ fullName: "Real Person0", email: "person0@example.test", phone: "+1 555 0100" });
    expect(data.employmentHistory[0]).toMatchObject({ status: "employed_full_time", company: "Acme Corp" });
    expect(data.consents.map((c) => c.purpose)).toEqual(["outcomes_reporting"]);
    expect(await prisma.auditLog.count({ where: { action: "data.export_self", entityId: g!.id } })).toBe(1);
  });

  it("staff deletion is admin-only and needs typed confirmation", async () => {
    const [g] = await population();
    await expect(deleteGraduateAsStaff(await staff("CAREER_SERVICES"), g!.id, "DELETE")).rejects.toBeInstanceOf(ForbiddenError);
    const admin = await staff("ADMIN");
    await expect(deleteGraduateAsStaff(admin, g!.id, "delete")).rejects.toThrow();
    await deleteGraduateAsStaff(admin, g!.id, "DELETE");
    expect((await prisma.graduate.findUniqueOrThrow({ where: { id: g!.id } })).anonymizedAt).not.toBeNull();
  });

  it("retention anonymizes graduates past the configured period and prunes old logs", async () => {
    await population(); // graduated 2025-01-31
    await prisma.auditLog.create({ data: { actorType: "system", action: "old", entityType: "X", at: D("2020-01-01") } });
    const r1 = await runRetention(D("2029-12-31"));
    expect(r1.anonymized).toBe(0);
    const r2 = await runRetention(D("2030-02-01"));
    expect(r2.anonymized).toBe(12);
    expect(r2.auditDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.graduate.count({ where: { emailEnc: { not: null } } })).toBe(0);
    // aggregates survive retention too: the employment history is still there
    expect(await prisma.employmentRecord.count()).toBe(12);
  });

  it("settings are validated: weights must sum to 100 and the privacy minimum can't drop below 5", async () => {
    const admin = await staff("ADMIN");
    await expect(updateSettings(admin, "matching", { weights: { skills: 90, role: 15, location: 15, boost: 10 }, recentGraduateDays: 90, longSearchDays: 60, longSearchFullDays: 180 })).rejects.toThrow(/add up to 100/);
    await expect(updateSettings(admin, "reporting", { employedStatuses: ["employed_full_time"], qualifyingJobStatuses: ["employed_full_time"], windowBeforeDays: 90, graceDays: 45, minCell: 2, freshnessDays: 90 })).rejects.toThrow();
    await updateSettings(admin, "retention", { anonymizeAfterYears: 3, auditLogDays: 365, emailLogDays: 30 });
    expect(await prisma.auditLog.count({ where: { action: "settings.update" } })).toBe(1);
    await expect(updateSettings(await staff("CAREER_SERVICES"), "retention", {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
