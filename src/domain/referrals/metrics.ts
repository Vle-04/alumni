/** Referral metrics computed from the transition history (pure). */
import type { ReferralStatus } from "../enums";
import { PIPELINE } from "./pipeline";
import { daysBetween, median } from "../stats/basic";

export interface ReferralFacts {
  id: string;
  openingId: string;
  companyId: string;
  companyName: string;
  isPartner: boolean;
  status: ReferralStatus;
  transitions: { toStatus: ReferralStatus; at: Date }[];
}

export interface StageConversion {
  from: ReferralStatus;
  to: ReferralStatus;
  reachedFrom: number;
  reachedTo: number;
  rate: number | null;
}

export function referralMetrics(refs: readonly ReferralFacts[]) {
  const reached = (r: ReferralFacts, s: ReferralStatus) => r.transitions.some((t) => t.toStatus === s);
  const conversions: StageConversion[] = PIPELINE.slice(0, -1).map((from, i) => {
    const to = PIPELINE[i + 1]!;
    const reachedFrom = refs.filter((r) => reached(r, from)).length;
    const reachedTo = refs.filter((r) => reached(r, to)).length;
    return { from, to, reachedFrom, reachedTo, rate: reachedFrom ? reachedTo / reachedFrom : null };
  });

  const perOpening = new Map<string, number>();
  for (const r of refs) perOpening.set(r.openingId, (perOpening.get(r.openingId) ?? 0) + 1);

  const hiresByCompany = new Map<string, { companyName: string; isPartner: boolean; hires: number }>();
  const daysToHire: number[] = [];
  for (const r of refs) {
    const hired = r.transitions.find((t) => t.toStatus === "hired");
    if (!hired) continue;
    const e = hiresByCompany.get(r.companyId) ?? { companyName: r.companyName, isPartner: r.isPartner, hires: 0 };
    e.hires++;
    hiresByCompany.set(r.companyId, e);
    // "Referral to hire" is measured from the moment the graduate was referred to the partner.
    const referred = r.transitions.find((t) => t.toStatus === "referred") ?? r.transitions[0];
    if (referred) daysToHire.push(daysBetween(referred.at, hired.at));
  }

  return {
    total: refs.length,
    byStatus: Object.fromEntries([...new Set(refs.map((r) => r.status))].map((s) => [s, refs.filter((r) => r.status === s).length])) as Partial<Record<ReferralStatus, number>>,
    conversions,
    perOpening,
    hiresByCompany: [...hiresByCompany.entries()].map(([companyId, v]) => ({ companyId, ...v })).sort((a, b) => b.hires - a.hires || a.companyName.localeCompare(b.companyName)),
    medianDaysReferralToHire: median(daysToHire),
    hires: daysToHire.length,
  };
}
