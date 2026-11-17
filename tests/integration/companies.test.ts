import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { acceptMerge, listMergeSuggestions, resolveCompany } from "@/server/services/companies";
import { resetDb, staff } from "./helpers";

describe("company normalization", () => {
  beforeEach(resetDb);

  it("resolves legal-form variants to the same company", async () => {
    const a = await resolveCompany(prisma, "Google");
    expect(await resolveCompany(prisma, "Google LLC")).toBe(a);
    expect(await resolveCompany(prisma, "google, inc.")).toBe(a);
    expect(await prisma.company.count()).toBe(1);
  });

  it("suggests — but does not perform — a merge for similar names; staff confirm", async () => {
    const cs = await staff("CAREER_SERVICES");
    const target = await resolveCompany(prisma, "Picsart");
    const source = await resolveCompany(prisma, "PicsArt Armenia");
    expect(source).not.toBe(target);
    await prisma.employmentRecord.create({ data: { graduateId: (await mkGrad()).id, status: "employed_full_time", companyId: source, source: "staff_entry" } });

    const suggestions = await listMergeSuggestions(cs);
    expect(suggestions).toHaveLength(1);
    expect(await prisma.company.count()).toBe(2); // nothing merged yet

    await acceptMerge(cs, suggestions[0]!.id);
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.employmentRecord.count({ where: { companyId: target } })).toBe(1);
    expect(await resolveCompany(prisma, "PicsArt Armenia")).toBe(target); // alias moved
  });
});

async function mkGrad() {
  const p = await prisma.program.create({ data: { name: `P${Math.random()}` } });
  const c = await prisma.cohort.create({ data: { programId: p.id, name: `C${Math.random()}`, startDate: new Date() } });
  return prisma.graduate.create({ data: { cohortId: c.id, fullName: "X" } });
}
