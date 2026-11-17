/**
 * Acceptance: "Setting a cohort's graduation date schedules exactly 4 surveys per graduate;
 * changing the date reschedules them with no duplicates."
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createCohort, updateCohort } from "@/server/services/cohorts";
import { createGraduate, updateGraduate } from "@/server/services/graduates";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("survey scheduling", () => {
  let cs: Awaited<ReturnType<typeof staff>>;
  beforeEach(async () => {
    await resetDb();
    cs = await staff("CAREER_SERVICES");
  });

  it("setting a graduation date schedules exactly 4 surveys per graduate; changing it reschedules without duplicates", async () => {
    const cohort = await makeCohort({ graduationDate: null });
    const grads = await Promise.all([1, 2, 3].map(() => makeGraduate(cohort.id)));
    expect(await prisma.surveyInstance.count()).toBe(0);

    const base = { programId: cohort.programId, name: cohort.name, startDate: "2026-01-05" };
    await updateCohort(cs, cohort.id, { ...base, graduationDate: future(30) });
    for (const g of grads) {
      const s = await prisma.surveyInstance.findMany({ where: { graduateId: g.id }, orderBy: { milestone: "asc" } });
      expect(s.map((x) => x.milestone)).toEqual([1, 3, 6, 12]);
      expect(s.every((x) => x.status === "scheduled")).toBe(true);
    }
    const before = await prisma.surveyInstance.findMany({ where: { graduateId: grads[0]!.id }, orderBy: { milestone: "asc" } });

    await updateCohort(cs, cohort.id, { ...base, graduationDate: future(60) });
    await updateCohort(cs, cohort.id, { ...base, graduationDate: future(60) }); // same date again: no-op
    expect(await prisma.surveyInstance.count()).toBe(12);
    const after = await prisma.surveyInstance.findMany({ where: { graduateId: grads[0]!.id }, orderBy: { milestone: "asc" } });
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id)); // same rows, moved
    expect(after[0]!.scheduledFor.getTime() - before[0]!.scheduledFor.getTime()).toBeGreaterThanOrEqual(29 * 86_400_000);
  });

  it("does not move surveys that were already sent or answered", async () => {
    const cohort = await makeCohort({ graduationDate: null });
    const g = await makeGraduate(cohort.id);
    const base = { programId: cohort.programId, name: cohort.name, startDate: "2026-01-05" };
    await updateCohort(cs, cohort.id, { ...base, graduationDate: future(-40) }); // 1-month milestone due ~10 days ago
    const first = await prisma.surveyInstance.findFirstOrThrow({ where: { graduateId: g.id, milestone: 1 } });
    await prisma.surveyInstance.update({ where: { id: first.id }, data: { status: "completed" } });
    await updateCohort(cs, cohort.id, { ...base, graduationDate: future(10) });
    const again = await prisma.surveyInstance.findUniqueOrThrow({ where: { id: first.id } });
    expect(again.scheduledFor).toEqual(first.scheduledFor);
    expect(again.status).toBe("completed");
  });

  it("removing the date cancels unsent surveys; long-past milestones are 'missed', never sent", async () => {
    const cohort = await makeCohort({ graduationDate: null });
    await makeGraduate(cohort.id);
    const base = { programId: cohort.programId, name: cohort.name, startDate: "2023-01-05" };
    await updateCohort(cs, cohort.id, { ...base, graduationDate: "2023-06-30" });
    expect((await prisma.surveyInstance.findMany()).map((s) => s.status)).toEqual(["missed", "missed", "missed", "missed"]);
    await updateCohort(cs, cohort.id, { ...base, graduationDate: "" });
    expect(new Set((await prisma.surveyInstance.findMany()).map((s) => s.status))).toEqual(new Set(["cancelled"]));
  });

  it("schedules surveys for graduates added later, and when a graduate's cohort changes", async () => {
    const program = await prisma.program.create({ data: { name: "P" } });
    const a = await createCohort(cs, { programId: program.id, name: "Cohort A", startDate: "2026-01-01", graduationDate: future(20) });
    const b = await createCohort(cs, { programId: program.id, name: "Cohort B", startDate: "2026-01-01", graduationDate: future(50) });
    const id = await createGraduate(cs, { fullName: "New Grad", email: "new@example.test", cohortId: a });
    expect(await prisma.surveyInstance.count({ where: { graduateId: id } })).toBe(4);
    const s1 = await prisma.surveyInstance.findFirstOrThrow({ where: { graduateId: id, milestone: 1 } });
    await updateGraduate(cs, id, { fullName: "New Grad", email: "new@example.test", cohortId: b });
    const s2 = await prisma.surveyInstance.findFirstOrThrow({ where: { graduateId: id, milestone: 1 } });
    expect(s2.id).toBe(s1.id);
    expect(s2.scheduledFor > s1.scheduledFor).toBe(true);
    expect(await prisma.surveyInstance.count({ where: { graduateId: id } })).toBe(4);
  });
});
