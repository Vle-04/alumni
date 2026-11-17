/** Career Services "Needs attention" queue. Individual-level → dashboard:read only. */
import { addDays, STALE_AFTER_DAYS } from "@/domain/records/staleness";
import { prisma } from "../db";
import { requirePermission, type RequestContext } from "../context";
import { openingsWithoutMatches } from "./placement";

export const LONG_SEARCH_DAYS = 60;
export const STUCK_REFERRAL_DAYS = 14;
export const NEW_OPENING_DAYS = 30;

export async function needsAttention(ctx: RequestContext, now = new Date()) {
  requirePermission(ctx, "dashboard:read");
  const longSince = addDays(now, -LONG_SEARCH_DAYS);
  const searching = await prisma.graduate.findMany({
    where: { anonymizedAt: null, currentStatus: "searching", searchingSince: { lt: longSince } },
    select: { id: true, fullName: true, searchingSince: true, cohort: { select: { name: true } }, referrals: { select: { createdAt: true } } },
    orderBy: { searchingSince: "asc" },
  });
  // "No referral" = no referral created since this search period started.
  const longSearchingNoReferral = searching.filter((g) => !g.referrals.some((r) => r.createdAt >= g.searchingSince!)).map(({ referrals: _r, ...g }) => g);

  const [bouncedSurveys, staleCount, stuckReferrals, failedEmails, openings] = await Promise.all([
    prisma.surveyInstance.findMany({
      where: { status: "bounced", graduate: { anonymizedAt: null } },
      orderBy: { scheduledFor: "desc" },
      take: 50,
      select: { id: true, milestone: true, scheduledFor: true, graduate: { select: { id: true, fullName: true } } },
    }),
    prisma.graduate.count({ where: { anonymizedAt: null, OR: [{ currentStatusAt: null }, { currentStatusAt: { lt: addDays(now, -STALE_AFTER_DAYS) } }] } }),
    prisma.referral.findMany({
      where: { status: { notIn: ["hired", "rejected", "withdrawn"] }, statusChangedAt: { lt: addDays(now, -STUCK_REFERRAL_DAYS) }, graduate: { anonymizedAt: null } },
      orderBy: { statusChangedAt: "asc" },
      select: { id: true, status: true, statusChangedAt: true, graduate: { select: { id: true, fullName: true } }, opening: { select: { id: true, title: true, company: { select: { canonicalName: true } } } } },
    }),
    prisma.outboundEmail.count({ where: { state: { in: ["dead", "uncertain"] } } }),
    openingsWithoutMatches(ctx),
  ]);
  const newCutoff = addDays(now, -NEW_OPENING_DAYS);
  return {
    longSearchingNoReferral,
    bouncedSurveys,
    staleCount,
    stuckReferrals,
    failedEmails,
    newOpeningsWithoutMatches: openings.filter((o) => o.createdAt >= newCutoff),
    allOpeningsWithoutMatches: openings.length,
  };
}
