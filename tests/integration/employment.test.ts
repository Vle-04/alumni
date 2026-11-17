import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addEmploymentRecordAsStaff } from "@/server/services/employment";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

describe("employment history", () => {
  beforeEach(resetDb);

  it("appends records, never overwrites, and keeps the cached status current", async () => {
    const cs = await staff("CAREER_SERVICES");
    const g = await makeGraduate((await makeCohort()).id);
    await addEmploymentRecordAsStaff(cs, g.id, { status: "searching" });
    await new Promise((r) => setTimeout(r, 5));
    await addEmploymentRecordAsStaff(cs, g.id, { status: "searching" });
    let grad = await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } });
    const first = await prisma.employmentRecord.findFirstOrThrow({ where: { graduateId: g.id }, orderBy: { reportedAt: "asc" } });
    expect(grad.currentStatus).toBe("searching");
    expect(grad.searchingSince?.getTime()).toBe(first.reportedAt.getTime()); // start of the searching run

    await addEmploymentRecordAsStaff(cs, g.id, { status: "employed_full_time", companyName: "Acme LLC", roleTitle: "Junior Dev", inField: true });
    grad = await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } });
    expect(grad.currentStatus).toBe("employed_full_time");
    expect(grad.currentInField).toBe(true);
    expect(grad.searchingSince).toBeNull();
    expect(await prisma.employmentRecord.count({ where: { graduateId: g.id } })).toBe(3);
  });

  it("requires a company for employed statuses", async () => {
    const cs = await staff("CAREER_SERVICES");
    const g = await makeGraduate((await makeCohort()).id);
    await expect(addEmploymentRecordAsStaff(cs, g.id, { status: "employed_full_time" })).rejects.toThrow(/Company is required/);
  });
});
