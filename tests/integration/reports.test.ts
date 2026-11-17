import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { exportReport, getOutcomesReport } from "@/server/services/reports";
import { needsAttention } from "@/server/services/dashboard";
import { setConsent } from "@/server/services/consent";
import { ForbiddenError } from "@/server/errors";
import * as placement from "@/server/services/placement";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

const sys = { actor: { type: "system" as const, id: "test" } };
const D = (s: string) => new Date(`${s}T00:00:00Z`);

async function population() {
  const cohort = await makeCohort({ name: "Report Cohort", graduationDate: D("2025-01-31") });
  const company = await prisma.company.create({ data: { canonicalName: "Bigco", isPartner: true } });
  const grads = [];
  for (let i = 0; i < 20; i++) {
    const g = await makeGraduate(cohort.id, { name: `Person Number${i}` });
    await setConsent(prisma, sys, g.id, "outcomes_reporting", true, "test");
    if (i < 12) await prisma.employmentRecord.create({ data: { graduateId: g.id, status: "employed_full_time", companyId: company.id, startDate: D("2025-04-01"), reportedAt: D("2025-07-25"), source: "survey_6m", inField: true } });
    else if (i < 17) await prisma.employmentRecord.create({ data: { graduateId: g.id, status: "searching", reportedAt: D("2025-07-25"), source: "survey_6m" } });
    grads.push(g);
  }
  return { cohort, company, grads };
}

describe("outcomes report", () => {
  beforeEach(resetDb);

  it("shows employment rate with response rate and unknowns, median time to job, top employers — and no individuals", async () => {
    await population();
    const mk = await staff("LEADERSHIP");
    const { report } = await getOutcomesReport(mk, {}, D("2026-11-01"));
    const m6 = report.milestones[0]!;
    expect(m6.population.display).toBe("20");
    expect(m6.employmentRate.display).toBe("71%"); // 12 / 17 known
    expect(m6.responseRate.display).toBe(">75%"); // 17/20 — 3 unknown is a small group, so a bound
    expect(m6.unknown.display).toBe("<5");
    expect(report.timeToJob.median).toBe(60); // 2025-01-31 → 2025-04-01
    expect(report.topEmployers).toEqual([{ name: "Bigco", isPartner: true, hires: 12 }]);
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/Person Number|@example\.test/);
  });

  it("moving a referral to hired updates the report", async () => {
    const { grads, company } = await population();
    const cs = await staff("CAREER_SERVICES");
    const before = (await getOutcomesReport(cs, {})).report;
    // One of the searching graduates is hired through a referral (today).
    const g = grads[12]!;
    await prisma.graduate.update({ where: { id: g.id }, data: { currentStatus: "searching" } });
    const opening = await prisma.opening.create({ data: { companyId: company.id, title: "Dev", description: "x", status: "open", remoteMode: "remote" } });
    const ref = await prisma.referral.create({ data: { openingId: opening.id, graduateId: g.id, referredById: cs.actor.id, status: "offer" } });
    await prisma.matchNotification.create({ data: { openingId: opening.id, graduateId: g.id, sentById: cs.actor.id, score: 80, response: "interested" } });
    await setConsent(prisma, sys, g.id, "share_with_partners", true, "test");
    await placement.moveReferral(cs, ref.id, "hired");
    const after = (await getOutcomesReport(cs, {})).report;
    expect(after.timeToJob.events.display).not.toBe(before.timeToJob.events.display);
    expect(after.topEmployers[0]!.hires).toBe(13);
  });

  it("leaves out graduates without reporting consent, and says so", async () => {
    const { grads } = await population();
    for (const g of grads.slice(0, 5)) await setConsent(prisma, sys, g.id, "outcomes_reporting", false, "test");
    const { report } = await getOutcomesReport(await staff("LEADERSHIP"), {}, D("2026-11-01"));
    expect(report.population.graduates.display).toBe("15");
    expect(report.population.excludedNoConsent.display).toBe("5");
  });

  it("filters by cohort granularity and refuses tiny populations", async () => {
    await population();
    const tiny = await makeCohort({ name: "Tiny Cohort", graduationDate: D("2025-03-31") });
    for (let i = 0; i < 2; i++) {
      const g = await makeGraduate(tiny.id);
      await setConsent(prisma, sys, g.id, "outcomes_reporting", true, "test");
    }
    const mk = await staff("LEADERSHIP");
    expect((await getOutcomesReport(mk, { cohortId: tiny.id })).report.tooSmall).toBe(true);
    const all = (await getOutcomesReport(mk, {})).report;
    expect(all.population.excludedSmallCohorts.display).toBe("<5");
    // Differencing attempt: a date range that excludes the tiny cohort gives identical numbers,
    // because small cohorts are never part of any figure.
    const without = (await getOutcomesReport(mk, { to: "2025-02" })).report;
    expect(without.milestones).toEqual(all.milestones);
  });

  it("exports are audited; CSV contains aggregates only", async () => {
    await population();
    const mk = await staff("LEADERSHIP");
    const csv = await exportReport(mk, {}, "csv");
    expect(csv.body).toContain("employment rate (of known status)");
    expect(String(csv.body)).not.toMatch(/Person Number/);
    const pdf = await exportReport(mk, {}, "pdf");
    expect(Buffer.isBuffer(pdf.body) && pdf.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(await prisma.auditLog.count({ where: { action: "report.export", actorId: mk.actor.id } })).toBe(2);
  });

  it("the needs-attention queue is for Career Services, not Marketing", async () => {
    await population();
    await expect(needsAttention(await staff("LEADERSHIP"))).rejects.toBeInstanceOf(ForbiddenError);
    const q = await needsAttention(await staff("CAREER_SERVICES"));
    expect(q.staleCount).toBe(20);
  });
});
