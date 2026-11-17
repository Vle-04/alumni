/**
 * New graduates default to "searching" at graduation unless they've said otherwise.
 *
 * The default is a PRESUMED status: an EmploymentRecord with source `graduation_default`.
 *  - It makes the graduate eligible for matching (and the long-search boost / dashboard queue).
 *  - It is EXCLUDED from every outcome metric, so a non-responder still counts as "unknown" and
 *    the response rate stays honest (see docs/METRICS.md).
 *  - Their first real answer (survey, self-update, staff entry) supersedes it.
 * Applies only to graduates who graduated within the last 30 days, have no records at all, and
 * haven't said they're not looking — imported historical cohorts are left alone.
 */
import { prisma, type Db } from "../db";
import { systemContext } from "../context";
import { addDays } from "@/domain/records/staleness";
import { appendEmploymentRecord } from "./employment";

export const GRADUATION_DEFAULT_WINDOW_DAYS = 30;

export async function applyGraduationDefaults(now = new Date(), onlyIds?: readonly string[], db: Db = prisma) {
  const from = addDays(now, -GRADUATION_DEFAULT_WINDOW_DAYS);
  const candidates = await db.graduate.findMany({
    where: {
      ...(onlyIds ? { id: { in: [...onlyIds] } } : {}),
      anonymizedAt: null,
      jobSearchStatus: { not: "not_looking" },
      employmentRecords: { none: {} },
      OR: [
        { graduationDateOverride: { gte: from, lte: now } },
        { graduationDateOverride: null, cohort: { graduationDate: { gte: from, lte: now } } },
      ],
    },
    select: { id: true, graduationDateOverride: true, cohort: { select: { graduationDate: true } } },
  });
  const ctx = systemContext("graduation-default");
  for (const g of candidates) {
    const at = g.graduationDateOverride ?? g.cohort.graduationDate!;
    await appendEmploymentRecord(db, ctx, g.id, { status: "searching" }, { source: "graduation_default", reportedAt: at });
  }
  return { defaulted: candidates.length };
}
