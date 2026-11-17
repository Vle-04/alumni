/**
 * AUDIT 24: deletion scrubbing must not damage other people's data.
 * Graduate "Mark Will" is deleted. Whole words only; shared records lose only the full name,
 * email and phone; a company other graduates rely on is never renamed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { blindIndex, encrypt } from "@/server/crypto";
import { createGraduate } from "@/server/services/graduates";
import { submitSelfUpdate } from "@/server/services/self-service";
import { anonymizeGraduate } from "@/server/services/privacy";
import { audit } from "@/server/audit";
import { makeCohort, resetDb, staff } from "./helpers";

const EMAIL = "mark.will@example.test";

describe("deleting 'Mark Will' leaves other people's data intact", () => {
  beforeEach(resetDb);

  it("removes 'Mark Will' and the email; keeps 'marketing', 'will', other graduates' text and a shared company name", async () => {
    const cs = await staff("CAREER_SERVICES");
    const cohortId = (await makeCohort()).id;
    const markId = await createGraduate(cs, { fullName: "Mark Will", email: EMAIL, cohortId });
    const otherId = await createGraduate(cs, { fullName: "William Marks", email: "w.marks@example.test", cohortId });
    const mark = { actor: { type: "graduate" as const, id: markId } };
    const other = { actor: { type: "graduate" as const, id: otherId } };

    // Mark's OWN records: a job title and a company only he is linked to.
    await submitSelfUpdate(mark, { mode: "update", status: "freelance_contract", companyName: "Will Bakery", roleTitle: "Marketing lead (Mark Will)", openToOffers: "no" });
    // A SHARED company: Mark and William both worked there.
    await submitSelfUpdate(mark, { mode: "update", status: "employed_full_time", companyName: "Mark Will Consulting", roleTitle: "Analyst", openToOffers: "no" });
    await submitSelfUpdate(other, { mode: "update", status: "employed_full_time", companyName: "Mark Will Consulting", roleTitle: "We will grow marketing", openToOffers: "no" });
    const sharedCo = await prisma.company.findFirstOrThrow({ where: { canonicalName: "Mark Will Consulting" } });

    // A SHARED opening Mark was referred to, and another graduate's opening he has nothing to do with.
    const partner = await prisma.company.create({ data: { canonicalName: "Partner Co", isPartner: true } });
    const sharedOpening = await prisma.opening.create({ data: { companyId: partner.id, title: "Marketing Assistant", description: `Marketing role. We will train you. Contact Mark Will at ${EMAIL}. Mark the date!`, remoteMode: "remote" } });
    await prisma.referral.create({ data: { openingId: sharedOpening.id, graduateId: markId, referredById: cs.actor.id } });
    const unrelatedOpening = await prisma.opening.create({ data: { companyId: partner.id, title: "Will Marketing Lead", description: "Mark our words: marketing will matter. Ask Mark.", remoteMode: "remote" } });
    await prisma.referral.create({ data: { openingId: unrelatedOpening.id, graduateId: otherId, referredById: cs.actor.id } });
    // An audit entry about someone else that mentions Mark (and contains "will"/"marketing").
    await audit(prisma, cs, { action: "note.other", entityType: "Graduate", entityId: otherId, meta: { note: "Mark Will said marketing will grow", fullName: "William Marks" } });
    const partnerContact = await prisma.partnerContact.create({ data: { companyId: partner.id, name: "Will Smith", emailEnc: encrypt("will.smith@partner.test"), emailHash: blindIndex("will.smith@partner.test") } });

    await prisma.$transaction((tx) => anonymizeGraduate(tx, cs, markId, "staff_request"));

    // ── Mark's identifiers are gone ──
    const markRecs = await prisma.employmentRecord.findMany({ where: { graduateId: markId }, include: { company: true }, orderBy: { reportedAt: "asc" } });
    expect(markRecs[0]!.roleTitle).toBe("Marketing lead ([removed])"); // "Marketing" untouched (whole words)
    expect(markRecs[0]!.company!.canonicalName).toBe("[removed] Bakery"); // own company: parts scrubbed
    const shared = await prisma.opening.findUniqueOrThrow({ where: { id: sharedOpening.id } });
    expect(shared.description).toBe("Marketing role. We will train you. Contact [removed] at [removed]. Mark the date!"); // single "Mark" kept in a SHARED record
    expect(shared.title).toBe("Marketing Assistant");

    // ── Other people's data is unchanged ──
    expect((await prisma.company.findUniqueOrThrow({ where: { id: sharedCo.id } })).canonicalName).toBe("Mark Will Consulting"); // shared company: never renamed
    expect(await prisma.companyAlias.count({ where: { companyId: sharedCo.id } })).toBeGreaterThan(0);
    const unrelated = await prisma.opening.findUniqueOrThrow({ where: { id: unrelatedOpening.id } });
    expect(unrelated).toMatchObject({ title: "Will Marketing Lead", description: "Mark our words: marketing will matter. Ask Mark." });
    const william = await prisma.graduate.findUniqueOrThrow({ where: { id: otherId }, include: { employmentRecords: true } });
    expect(william.fullName).toBe("William Marks");
    expect(william.employmentRecords.map((r) => r.roleTitle)).toContain("We will grow marketing");
    const otherAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "note.other" } });
    expect(otherAudit.diff).toEqual({ meta: { note: "[removed] said marketing will grow", fullName: "William Marks" } }); // keys of others' entries untouched
    expect((await prisma.partnerContact.findUniqueOrThrow({ where: { id: partnerContact.id } })).name).toBe("Will Smith");

    // ── And the full name and email exist nowhere except the deliberately kept shared company ──
    const leftovers = await prisma.$queryRaw<{ t: string }[]>`
      SELECT 'opening' AS t FROM "Opening" WHERE description ILIKE ${"%" + EMAIL + "%"} OR description ILIKE '%Mark Will %'
      UNION ALL SELECT 'record' FROM "EmploymentRecord" WHERE "roleTitle" ILIKE '%Mark Will%'
      UNION ALL SELECT 'audit' FROM "AuditLog" WHERE diff::text ILIKE '%Mark Will%' OR diff::text ILIKE ${"%" + EMAIL + "%"}
      UNION ALL SELECT 'graduate' FROM "Graduate" WHERE "fullName" ILIKE '%Mark Will%'`;
    expect(leftovers).toEqual([]);
  });
});
