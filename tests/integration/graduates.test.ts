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
