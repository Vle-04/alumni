/**
 * Cross-feature side effects, kept in one place so services don't import each other in cycles.
 * Phase 2 wires survey scheduling in here.
 */
import type { RequestContext } from "../context";

export async function onCohortGraduationDateChanged(_ctx: RequestContext, _cohortId: string): Promise<void> {}
export async function onGraduatesCreated(_ctx: RequestContext, _graduateIds: string[]): Promise<void> {}
