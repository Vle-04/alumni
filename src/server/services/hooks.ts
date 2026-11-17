/**
 * Cross-feature side effects, kept in one place so services don't import each other in cycles.
 */
import { prisma } from "../db";
import type { RequestContext } from "../context";
import { audit } from "../audit";
import { scheduleSurveysForCohort, scheduleSurveysForGraduates } from "./surveys";
import { applyGraduationDefaults } from "./graduation";

/** Setting or changing a cohort's graduation date (re)schedules every graduate's surveys. */
export async function onCohortGraduationDateChanged(ctx: RequestContext, cohortId: string): Promise<void> {
  const r = await scheduleSurveysForCohort(prisma, cohortId);
  const ids = (await prisma.graduate.findMany({ where: { cohortId }, select: { id: true } })).map((g) => g.id);
  await applyGraduationDefaults(new Date(), ids);
  await audit(prisma, ctx, { action: "survey.reschedule_cohort", entityType: "Cohort", entityId: cohortId, meta: r });
}

export async function onGraduatesCreated(_ctx: RequestContext, graduateIds: string[]): Promise<void> {
  await scheduleSurveysForGraduates(prisma, graduateIds);
  await applyGraduationDefaults(new Date(), graduateIds);
}

/** Cohort or graduation-date override changed for one graduate. */
export async function onGraduateScheduleInputsChanged(_ctx: RequestContext, graduateId: string): Promise<void> {
  await scheduleSurveysForGraduates(prisma, [graduateId]);
}
