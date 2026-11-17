/**
 * Cross-feature side effects, kept in one place so services don't import each other in cycles.
 */
import { prisma } from "../db";
import type { RequestContext } from "../context";
import { audit } from "../audit";
import { scheduleSurveysForCohort, scheduleSurveysForGraduates } from "./surveys";

/** Setting or changing a cohort's graduation date (re)schedules every graduate's surveys. */
export async function onCohortGraduationDateChanged(ctx: RequestContext, cohortId: string): Promise<void> {
  const r = await scheduleSurveysForCohort(prisma, cohortId);
  await audit(prisma, ctx, { action: "survey.reschedule_cohort", entityType: "Cohort", entityId: cohortId, meta: r });
}

export async function onGraduatesCreated(_ctx: RequestContext, graduateIds: string[]): Promise<void> {
  await scheduleSurveysForGraduates(prisma, graduateIds);
}

/** Cohort or graduation-date override changed for one graduate. */
export async function onGraduateScheduleInputsChanged(_ctx: RequestContext, graduateId: string): Promise<void> {
  await scheduleSurveysForGraduates(prisma, [graduateId]);
}
