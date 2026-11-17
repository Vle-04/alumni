import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ConflictError } from "@/server/errors";
import * as svc from "@/server/services/graduates";
import { addEmploymentRecordAsStaff } from "@/server/services/employment";
import { makeCohort, resetDb, staff } from "./helpers";

describe("graduate records", () => {
  let cs: Awaited<ReturnType<typeof staff>>;
  let cohortId: string;
  beforeEach(async () => {
    await resetDb();
    cs = await staff("CAREER_SERVICES");
    cohortId = (await makeCohort()).id;
  });

  const base = () => ({ fullName: "Ani Petrosyan", email: "Ani@Example.com", phone: "+374 91 000000", cohortId, skills: [{ name: "JS", level: 4 }] });

  it("encrypts contact fields at rest and never stores plaintext", async () => {
    await prisma.skill.create({ data: { canonicalName: "JavaScript", synonyms: { create: { alias: "js" } } } });
    const id = await svc.createGraduate(cs, base());
    const raw = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "Graduate" WHERE id = ${id}`;
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain("ani@example.com");
    expect(dump).not.toContain("000000");
    const skills = await prisma.graduateSkill.findMany({ where: { graduateId: id }, include: { skill: true } });
    expect(skills.map((s) => s.skill.canonicalName)).toEqual(["JavaScript"]); // synonym resolved
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    await svc.createGraduate(cs, base());
    await expect(svc.createGraduate(cs, { ...base(), email: "ANI@example.com" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("audits contact reads and redacts contact values in diffs", async () => {
    const id = await svc.createGraduate(cs, base());
    const contact = await svc.revealContact(cs, id);
    expect(contact.email).toBe("ani@example.com");
    await svc.updateGraduate(cs, id, { ...base(), email: "new@example.com" });
    const logs = await prisma.auditLog.findMany({ where: { entityId: id } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["graduate.create", "contact.read", "graduate.update"]));
    expect(JSON.stringify(logs)).not.toMatch(/example\.com|000000/);
    const update = logs.find((l) => l.action === "graduate.update");
    expect(update?.diff).toMatchObject({ changes: { email: { changed: true } } });
    expect((update?.diff as { changes: Record<string, unknown> }).changes).not.toHaveProperty("phone"); // unchanged → not logged
  });

  it("detail view does not include contact data", async () => {
    const id = await svc.createGraduate(cs, base());
    const d = await svc.getGraduateDetail(cs, id);
    expect(d.hasEmail).toBe(true);
    expect(JSON.stringify(d)).not.toContain("ani@example.com");
    expect(d).not.toHaveProperty("emailEnc");
  });

  it("filters by status, stale and skill", async () => {
    const a = await svc.createGraduate(cs, base());
    await svc.createGraduate(cs, { ...base(), fullName: "Bob", email: "bob@example.com", skills: [] });
    await addEmploymentRecordAsStaff(cs, a, { status: "searching" });
    const searching = await svc.listGraduates(cs, { status: "searching" });
    expect(searching.rows.map((r) => r.id)).toEqual([a]);
    const stale = await svc.listGraduates(cs, { stale: "1" });
    expect(stale.rows.map((r) => r.fullName)).toEqual(["Bob"]); // never updated → stale
    const skill = await prisma.skill.findFirstOrThrow({ where: { canonicalName: "JS" } });
    expect((await svc.listGraduates(cs, { skillId: skill.id })).total).toBe(1);
  });

  it("rotating the link increments the token version", async () => {
    const id = await svc.createGraduate(cs, base());
    expect(await svc.rotateProfileLink(cs, id)).toBe(2);
  });
});

describe("AUDIT 12: staff change an unreachable email", () => {
  beforeEach(resetDb);
  it("is audit-logged distinctly, revokes old links, and re-sends the bounced check-in to the new address", async () => {
    const { setEmailAdapter } = await import("@/server/email/adapters");
    const { PermanentEmailError } = await import("@/server/email/types");
    const { FakeEmailAdapter } = await import("./fake-email");
    const { enqueueEmail, processOutbox } = await import("@/server/outbox");
    const { createGraduateToken, resolveGraduateToken } = await import("@/server/tokens");
    const fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
    const cs = await staff("CAREER_SERVICES");
    const cohortId = (await makeCohort({ graduationDate: null })).id;
    const id = await svc.createGraduate(cs, { fullName: "Bounce Person", email: "old@example.test", cohortId });
    const survey = await prisma.surveyInstance.create({ data: { graduateId: id, milestone: 3, scheduledFor: new Date(), status: "queued" } });
    await enqueueEmail(prisma, { idempotencyKey: `survey:${survey.id}:initial`, graduateId: id, kind: "survey_initial", payload: { surveyId: survey.id, milestone: 3 } });
    const noon = (() => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, 12)); })();
    fake.failures.push(new PermanentEmailError("550 no such user"));
    await processOutbox({ now: noon });
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: survey.id } })).status).toBe("bounced");
    const oldLink = createGraduateToken((await prisma.graduate.findUniqueOrThrow({ where: { id } })), "profile");

    await svc.updateGraduate(cs, id, { fullName: "Bounce Person", email: "new@example.test", cohortId });

    expect(await prisma.auditLog.count({ where: { action: "graduate.email_changed_by_staff", entityId: id, actorId: cs.actor.id } })).toBe(1);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: id } }))).not.toMatch(/old@example|new@example/);
    expect(await resolveGraduateToken(oldLink, ["profile"])).toEqual({ ok: false, reason: "revoked" });
    await processOutbox({ now: noon });
    expect(fake.sent.at(-1)!.to).toBe("new@example.test");
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: survey.id } })).status).toBe("sent");
    setEmailAdapter(undefined);
  });

  it("is not triggered by edits that keep the same email", async () => {
    const cs = await staff("CAREER_SERVICES");
    const cohortId = (await makeCohort()).id;
    const id = await svc.createGraduate(cs, { fullName: "Same Email", email: "same@example.test", cohortId });
    await svc.updateGraduate(cs, id, { fullName: "Same Email Renamed", email: "SAME@example.test", cohortId });
    expect(await prisma.auditLog.count({ where: { action: "graduate.email_changed_by_staff" } })).toBe(0);
  });
});
