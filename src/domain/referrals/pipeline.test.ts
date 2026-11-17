import { describe, expect, it } from "vitest";
import { allowedTargets, canShareWithPartner, checkTransition } from "./pipeline";
import { referralMetrics, type ReferralFacts } from "./metrics";

const staff = { actor: "staff" as const, interested: true, shareConsent: true };

describe("referral transitions", () => {
  it("only the graduate can express interest", () => {
    expect(checkTransition("suggested", "graduate_interested", staff).ok).toBe(false);
    expect(checkTransition("suggested", "graduate_interested", { ...staff, actor: "graduate" }).ok).toBe(true);
  });

  it("graduates can only say interested or not interested", () => {
    expect(checkTransition("suggested", "withdrawn", { ...staff, actor: "graduate" }).ok).toBe(true);
    expect(checkTransition("graduate_interested", "referred", { ...staff, actor: "graduate" }).ok).toBe(false);
  });

  it("refuses to share with the partner without Interested AND share consent", () => {
    expect(checkTransition("graduate_interested", "referred", { ...staff, shareConsent: false })).toEqual({ ok: false, reason: expect.stringContaining("agreed to share") });
    expect(checkTransition("graduate_interested", "referred", { ...staff, interested: false })).toEqual({ ok: false, reason: expect.stringContaining("interested") });
    expect(checkTransition("graduate_interested", "referred", staff).ok).toBe(true);
    // consent revoked mid-process: cannot move further along
    expect(checkTransition("interviewing", "offer", { ...staff, shareConsent: false }).ok).toBe(false);
    expect(canShareWithPartner(true, true)).toBe(true);
    expect(canShareWithPartner(true, false)).toBe(false);
    expect(canShareWithPartner(false, true)).toBe(false);
  });

  it("allows forward steps, single back steps, and closing from any open stage", () => {
    expect(checkTransition("referred", "interviewing", staff).ok).toBe(true);
    expect(checkTransition("interviewing", "referred", staff).ok).toBe(true);
    expect(checkTransition("offer", "referred", staff).ok).toBe(false);
    expect(checkTransition("referred", "offer", staff).ok).toBe(true);
    expect(checkTransition("suggested", "rejected", staff).ok).toBe(true);
    expect(checkTransition("suggested", "referred", staff).ok).toBe(false);
  });

  it("hired only from offer; a hire can only be undone back to offer", () => {
    expect(checkTransition("interviewing", "hired", staff).ok).toBe(false);
    expect(checkTransition("offer", "hired", staff).ok).toBe(true);
    expect(checkTransition("hired", "rejected", staff).ok).toBe(false);
    expect(checkTransition("hired", "offer", staff).ok).toBe(true);
    expect(checkTransition("hired", "offer", { ...staff, shareConsent: false }).ok).toBe(true); // undo never blocked by consent
    expect(checkTransition("hired", "offer", { ...staff, actor: "graduate" }).ok).toBe(false);
    expect(allowedTargets("hired", staff)).toEqual(["offer"]);
  });

  it("reopens closed referrals to their previous stage or earlier", () => {
    expect(checkTransition("rejected", "interviewing", { ...staff, lastOpenStatus: "interviewing" }).ok).toBe(true);
    expect(checkTransition("rejected", "offer", { ...staff, lastOpenStatus: "interviewing" }).ok).toBe(false);
  });

  it("lists allowed targets", () => {
    expect(allowedTargets("offer", staff)).toEqual(["interviewing", "hired", "rejected", "withdrawn"]);
    expect(allowedTargets("same" as never, staff)).not.toContain("same");
    expect(checkTransition("offer", "offer", staff).ok).toBe(false);
  });
});

describe("referral metrics", () => {
  const d = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
  const ref = (id: string, path: [string, number][], company = "A"): ReferralFacts => ({
    id, openingId: `o-${company}`, companyId: company, companyName: `Company ${company}`, isPartner: company === "A",
    status: path.at(-1)![0] as never, transitions: path.map(([s, day]) => ({ toStatus: s as never, at: d(day) })),
  });
  const refs = [
    ref("1", [["suggested", 0], ["graduate_interested", 1], ["referred", 2], ["interviewing", 5], ["offer", 10], ["hired", 12]]),
    ref("2", [["suggested", 0], ["graduate_interested", 1], ["referred", 4], ["interviewing", 8], ["offer", 20], ["hired", 34]], "B"),
    ref("3", [["suggested", 0], ["graduate_interested", 2], ["referred", 3], ["rejected", 9]]),
    ref("4", [["suggested", 0], ["withdrawn", 1]]),
  ];
  it("computes conversion per stage, hires per company and median days referral → hire", () => {
    const m = referralMetrics(refs);
    expect(m.total).toBe(4);
    expect(m.conversions[0]).toEqual({ from: "suggested", to: "graduate_interested", reachedFrom: 4, reachedTo: 3, rate: 0.75 });
    expect(m.conversions[2]).toMatchObject({ from: "referred", to: "interviewing", reachedFrom: 3, reachedTo: 2 });
    expect(m.hiresByCompany).toEqual([{ companyId: "A", companyName: "Company A", isPartner: true, hires: 1 }, { companyId: "B", companyName: "Company B", isPartner: false, hires: 1 }]);
    expect(m.medianDaysReferralToHire).toBe(20); // (10 + 30) / 2
    expect(m.perOpening.get("o-A")).toBe(3);
  });
  it("handles no referrals", () => {
    const m = referralMetrics([]);
    expect(m.medianDaysReferralToHire).toBeNull();
    expect(m.conversions.every((c) => c.rate === null)).toBe(true);
  });
});
