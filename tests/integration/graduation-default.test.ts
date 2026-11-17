/** Audit item 13: new graduates default to "searching" at graduation unless they say otherwise. */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { applyGraduationDefaults } from "@/server/services/graduation";
import { candidatesForOpening } from "@/server/services/placement";
import { getOutcomesReport } from "@/server/services/reports";
import { setConsent } from "@/server/services/consent";
import { submitSelfUpdate } from "@/server/services/self-service";
import { updateCohort } from "@/server/services/cohorts";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

const sys = { actor: { type: "system" as const, id: "t" } };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("graduation default", () => {
  beforeEach(resetDb);

  it("sets new graduates to searching (since graduation) when the cohort graduates, unless they said otherwise", async () => {
    const cs = await staff("CAREER_SERVICES");
    const cohort = await makeCohort({ graduationDate: null });
    const a = await makeGraduate(cohort.id);
    const notLooking = await makeGraduate(cohort.id);
    await prisma.graduate.update({ where: { id: notLooking.id }, data: { jobSearchStatus: "not_looking" } });
    const alreadyAnswered = await makeGraduate(cohort.id);
    await prisma.employmentRecord.create({ data: { graduateId: alreadyAnswered.id, status: "employed_full_time", source: "self_update", reportedAt: daysAgo(1) } });

    const gradDate = daysAgo(3).toISOString().slice(0, 10);
    await updateCohort(cs, cohort.id, { programId: cohort.programId, name: cohort.name, startDate: "2026-01-01", graduationDate: gradDate });

    const ga = await prisma.graduate.findUniqueOrThrow({ where: { id: a.id }, include: { employmentRecords: true } });
    expect(ga.currentStatus).toBe("searching");
    expect(ga.searchingSince?.toISOString().slice(0, 10)).toBe(gradDate);
    expect(ga.employmentRecords[0]!.source).toBe("graduation_default");
    expect((await prisma.graduate.findUniqueOrThrow({ where: { id: notLooking.id } })).currentStatus).toBe("unknown");
    expect(await prisma.employmentRecord.count({ where: { graduateId: alreadyAnswered.id } })).toBe(1);
    expect(await applyGraduationDefaults()).toEqual({ defaulted: 0 }); // idempotent
  });

  it("is not applied to historical cohorts (only within 30 days of graduation)", async () => {
    const c = await makeCohort({ graduationDate: daysAgo(400) });
    await makeGraduate(c.id);
    expect(await applyGraduationDefaults()).toEqual({ defaulted: 0 });
  });

  it("makes them matchable, but they still count as UNKNOWN in every outcome metric", async () => {
    const cs = await staff("CAREER_SERVICES");
    const c = await makeCohort({ graduationDate: daysAgo(5) });
    const company = await prisma.company.create({ data: { canonicalName: "Co" } });
    const opening = await prisma.opening.create({ data: { companyId: company.id, title: "Dev", description: "x", remoteMode: "remote", status: "open" } });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const g = await makeGraduate(c.id);
      await setConsent(prisma, sys, g.id, "job_matching", true, "t");
      await setConsent(prisma, sys, g.id, "outcomes_reporting", true, "t");
      ids.push(g.id);
    }
    await applyGraduationDefaults();
    expect((await candidatesForOpening(cs, opening.id)).ranked).toHaveLength(6);

    const report = (await getOutcomesReport(cs, {}, daysAgo(-400))).report; // far enough ahead for milestones to be measurable
    expect(report.milestones[0]!.unknown.display).toBe("6");
    expect(report.milestones[0]!.responseRate.display).toBe("0%");

    // A real answer supersedes the presumption.
    await submitSelfUpdate({ actor: { type: "graduate", id: ids[0]! } }, { mode: "update", status: "employed_full_time", companyName: "Co", openToOffers: "no" });
    expect((await prisma.graduate.findUniqueOrThrow({ where: { id: ids[0]! } })).currentStatus).toBe("employed_full_time");
  });
});
