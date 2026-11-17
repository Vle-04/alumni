import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import type { RequestContext } from "@/server/context";
import { createOpening, submitOpeningAsPartner, setOpeningStatus } from "@/server/services/openings";
import * as placement from "@/server/services/placement";
import { partnerCandidate, partnerDashboard } from "@/server/services/partner";
import { setConsent } from "@/server/services/consent";
import { processOutbox } from "@/server/outbox";
import { blindIndex, encrypt } from "@/server/crypto";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

describe("placement board", () => {
  let cs: Awaited<ReturnType<typeof staff>>;
  let fake: FakeEmailAdapter;
  let openingId: string;
  let companyId: string;
  let partnerCtx: RequestContext & { actor: { type: "partner"; id: string; companyId: string } };

  async function searchingGrad(name: string, opts: { matching?: boolean; share?: boolean; skills?: [string, number][]; city?: string } = {}) {
    const g = await makeGraduate((await prisma.cohort.findFirstOrThrow()).id, { name, email: `${name.toLowerCase().replace(/\s/g, "")}@example.test` });
    await prisma.graduate.update({ where: { id: g.id }, data: { currentStatus: "searching", searchingSince: new Date(), city: opts.city ?? "Berlin", preferredRoleCategories: ["frontend"], linkedinUrlEnc: encrypt("https://www.linkedin.com/in/x") } });
    for (const [skill, level] of opts.skills ?? [["JavaScript", 4], ["React", 3]]) {
      const s = await prisma.skill.upsert({ where: { canonicalName: skill }, create: { canonicalName: skill }, update: {} });
      await prisma.graduateSkill.create({ data: { graduateId: g.id, skillId: s.id, level } });
    }
    const sys = { actor: { type: "system" as const, id: "test" } };
    if (opts.matching !== false) await setConsent(prisma, sys, g.id, "job_matching", true, "test");
    if (opts.share) await setConsent(prisma, sys, g.id, "share_with_partners", true, "test");
    return g;
  }

  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
    cs = await staff("CAREER_SERVICES");
    await makeCohort();
    const company = await prisma.company.create({ data: { canonicalName: "Northwind", isPartner: true } });
    companyId = company.id;
    const contact = await prisma.partnerContact.create({ data: { companyId, name: "Pat Partner", emailEnc: encrypt("pat@northwind.test"), emailHash: blindIndex("pat@northwind.test") } });
    partnerCtx = { actor: { type: "partner", id: contact.id, companyId } };
    openingId = await createOpening(cs, {
      companyId, title: "Junior Frontend Developer", description: "Build things with React.", roleCategory: "frontend", city: "Berlin", remoteMode: "hybrid", seniority: "junior",
      skills: [{ name: "JS", weight: 5, mustHave: true }, { name: "React", weight: 3, mustHave: false }],
    });
  });
  afterEach(() => setEmailAdapter(undefined));

  it("ranks only eligible candidates, each with a readable explanation", async () => {
    const strong = await searchingGrad("Strong Match", { skills: [["JavaScript", 5], ["React", 5]] });
    const weak = await searchingGrad("Weak Match", { skills: [["JavaScript", 2]] });
    await searchingGrad("No Consent", { matching: false });
    await searchingGrad("Wrong City", { city: "Lisbon" });
    await prisma.skill.update({ where: { canonicalName: "JS" }, data: {} }).catch(() => undefined);
    // "JS" on the opening was created as its own skill (no synonym yet) — add it as a synonym by merging:
    const { mergeSkillInto } = await import("@/server/services/skills-admin");
    const admin = await staff("ADMIN");
    const js = await prisma.skill.findUniqueOrThrow({ where: { canonicalName: "JS" } });
    const javascript = await prisma.skill.findUniqueOrThrow({ where: { canonicalName: "JavaScript" } });
    await mergeSkillInto(admin, js.id, javascript.id);

    const r = await placement.candidatesForOpening(cs, openingId);
    expect(r.ranked.map((m) => m.candidateId)).toEqual([strong.id, weak.id]);
    expect(r.ranked[0]!.explanation[0]).toBe("Matches 2 of 2 required skills.");
    expect(r.ranked[1]!.explanation[0]).toBe("Matches 1 of 2 required skills; missing: React.");
    expect(r.excludedByReason).toMatchObject({ no_matching_consent: 1, location: 1 });
  });

  it("notifies a graduate once, creates a 'suggested' referral, and emails them", async () => {
    await prisma.skill.create({ data: { canonicalName: "Placeholder" } });
    const g = await searchingGrad("Ana Fit", { skills: [["JS", 4], ["React", 4]] });
    const id = await placement.notifyGraduate(cs, openingId, g.id);
    await expect(placement.notifyGraduate(cs, openingId, g.id)).rejects.toBeInstanceOf(ConflictError);
    const ref = await prisma.referral.findFirstOrThrow({ where: { graduateId: g.id } });
    expect(ref.status).toBe("suggested");
    const t = new Date(); await processOutbox({ now: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, 12)) });
    expect(fake.sent[0]!.subject).toContain("Junior Frontend Developer");
    expect(fake.sent[0]!.text).toContain("/u/");
    expect(id).toBeTruthy();
  });

  it("refuses to notify ineligible graduates", async () => {
    const g = await searchingGrad("No Consent", { matching: false, skills: [["JS", 4]] });
    await expect(placement.notifyGraduate(cs, openingId, g.id)).rejects.toThrow(/agreed to job matching/);
  });

  describe("sharing with partners (acceptance)", () => {
    async function referred(opts: { interested: boolean; share: boolean }) {
      const g = await searchingGrad(`Grad ${Math.random().toString(36).slice(2, 7)}`, { share: opts.share, skills: [["JS", 4]] });
      const matchId = await placement.notifyGraduate(cs, openingId, g.id);
      if (opts.interested) await placement.respondToMatch({ actor: { type: "graduate", id: g.id } }, matchId, "interested");
      const ref = await prisma.referral.findFirstOrThrow({ where: { graduateId: g.id } });
      return { g, ref };
    }

    it("cannot refer (share with partner) without BOTH the Interested click and share consent", async () => {
      const notInterested = await referred({ interested: false, share: true });
      const noConsent = await referred({ interested: true, share: false });
      const both = await referred({ interested: true, share: true });
      await expect(placement.moveReferral(cs, notInterested.ref.id, "referred")).rejects.toBeInstanceOf(ValidationError);
      await expect(placement.moveReferral(cs, noConsent.ref.id, "referred")).rejects.toBeInstanceOf(ValidationError);
      await placement.moveReferral(cs, both.ref.id, "referred");
      expect((await prisma.referral.findUniqueOrThrow({ where: { id: both.ref.id } })).status).toBe("referred");
    });

    it("the partner gate returns details only with both conditions, re-checked on every read", async () => {
      const cases = await Promise.all([
        referred({ interested: false, share: false }),
        referred({ interested: false, share: true }),
        referred({ interested: true, share: false }),
        referred({ interested: true, share: true }),
      ]);
      const results = [];
      for (const c of cases) results.push(await partnerCandidate(partnerCtx, c.ref));
      expect(results.map((r) => r.shared)).toEqual([false, false, false, true]);
      expect(JSON.stringify(results.slice(0, 3))).not.toMatch(/Grad |@example\.test|linkedin/);

      // The partner sees the referred graduate on their dashboard…
      const ok = cases[3]!;
      await placement.moveReferral(cs, ok.ref.id, "referred");
      let dash = await partnerDashboard(partnerCtx);
      expect(dash.referrals).toHaveLength(1);
      expect(dash.referrals[0]!.candidate).toMatchObject({ shared: true, email: ok.g.fullName ? expect.stringContaining("@example.test") : "" });
      // …until the graduate revokes share consent: details disappear immediately.
      await setConsent(prisma, { actor: { type: "graduate", id: ok.g.id } }, ok.g.id, "share_with_partners", false, "self_update");
      dash = await partnerDashboard(partnerCtx);
      expect(dash.referrals[0]!.candidate).toEqual({ shared: false });
      expect(JSON.stringify(dash)).not.toContain("@example.test");
      // and every disclosure was audited (one direct read above + one dashboard read)
      expect(await prisma.auditLog.count({ where: { action: "contact.read", actorType: "partner", entityId: ok.g.id } })).toBe(2);
    });

    it("partners never see referrals that weren't referred to them", async () => {
      await referred({ interested: true, share: true }); // still at graduate_interested
      expect((await partnerDashboard(partnerCtx)).referrals).toEqual([]);
    });
  });

  it("only the graduate can mark interest; 'Not interested' withdraws the referral", async () => {
    const g = await searchingGrad("Maybe", { skills: [["JS", 4]] });
    const matchId = await placement.notifyGraduate(cs, openingId, g.id);
    const ref = await prisma.referral.findFirstOrThrow({ where: { graduateId: g.id } });
    await expect(placement.moveReferral(cs, ref.id, "graduate_interested")).rejects.toThrow(/Only the graduate/);
    await placement.respondToMatch({ actor: { type: "graduate", id: g.id } }, matchId, "not_interested");
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("withdrawn");
    await placement.respondToMatch({ actor: { type: "graduate", id: g.id } }, matchId, "interested"); // changed their mind
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("graduate_interested");
  });

  it("moving to hired creates a prefilled employment record; confirming with corrections appends a verified one", async () => {
    const g = await searchingGrad("Hire Me", { share: true, skills: [["JS", 4]] });
    const matchId = await placement.notifyGraduate(cs, openingId, g.id);
    await placement.respondToMatch({ actor: { type: "graduate", id: g.id } }, matchId, "interested");
    const ref = await prisma.referral.findFirstOrThrow({ where: { graduateId: g.id } });
    for (const s of ["referred", "interviewing", "offer"]) await placement.moveReferral(cs, ref.id, s);
    const { hireRecordId } = await placement.moveReferral(cs, ref.id, "hired");
    const rec = await prisma.employmentRecord.findUniqueOrThrow({ where: { id: hireRecordId! }, include: { company: true } });
    expect(rec).toMatchObject({ status: "employed_full_time", source: "referral_hire", roleTitle: "Junior Frontend Developer" });
    expect(rec.company?.canonicalName).toBe("Northwind");
    expect((await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } })).currentStatus).toBe("employed_full_time");

    await placement.confirmHire(cs, ref.id, { employmentStatus: "employed_full_time", startDate: "2026-06-01", inField: "yes" });
    const recs = await prisma.employmentRecord.findMany({ where: { graduateId: g.id, source: "referral_hire" }, orderBy: { createdAt: "asc" } });
    expect(recs).toHaveLength(2);
    expect(recs[1]).toMatchObject({ supersedesId: recs[0]!.id, inField: true, verifiedById: cs.actor.id });
    const transitions = await prisma.referralTransition.findMany({ where: { referralId: ref.id }, orderBy: { at: "asc" } });
    expect(transitions.map((t) => t.toStatus)).toEqual(["suggested", "graduate_interested", "referred", "interviewing", "offer", "hired"]);
    await expect(placement.moveReferral(cs, ref.id, "rejected")).rejects.toThrow(/only be undone back to Offer/);
  });

  it("AUDIT 6: moving a referral back out of Hired removes the employment record(s) it created", async () => {
    const g = await searchingGrad("Undo Hire", { share: true, skills: [["JS", 4]] });
    const own = await prisma.employmentRecord.create({ data: { graduateId: g.id, status: "searching", source: "self_update", reportedAt: new Date(Date.now() - 86_400_000) } });
    const matchId = await placement.notifyGraduate(cs, openingId, g.id);
    await placement.respondToMatch({ actor: { type: "graduate", id: g.id } }, matchId, "interested");
    const ref = await prisma.referral.findFirstOrThrow({ where: { graduateId: g.id } });
    for (const s of ["referred", "interviewing", "offer", "hired"]) await placement.moveReferral(cs, ref.id, s);
    await placement.confirmHire(cs, ref.id, { employmentStatus: "employed_part_time", inField: "yes" }); // a correction chained to it
    expect(await prisma.employmentRecord.count({ where: { graduateId: g.id, source: "referral_hire" } })).toBe(2);

    await placement.moveReferral(cs, ref.id, "offer");
    expect(await prisma.employmentRecord.count({ where: { graduateId: g.id, source: "referral_hire" } })).toBe(0);
    expect(await prisma.employmentRecord.findUnique({ where: { id: own.id } })).not.toBeNull(); // graduate's own report untouched
    const grad = await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } });
    expect(grad).toMatchObject({ currentStatus: "searching", jobSearchStatus: "active" });
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: ref.id } })).hireRecordId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "employment.retract_hire", entityId: g.id } })).toBe(2);
    // and it can be hired again later
    const again = await placement.moveReferral(cs, ref.id, "hired");
    expect(again.hireRecordId).toBeTruthy();
  });

  it("referral metrics: conversion per stage and hires per partner", async () => {
    const g = await searchingGrad("Metric", { share: true, skills: [["JS", 4]] });
    const matchId = await placement.notifyGraduate(cs, openingId, g.id);
    await placement.respondToMatch({ actor: { type: "graduate", id: g.id } }, matchId, "interested");
    const m = await placement.referralMetricsView(cs);
    expect(m.total).toBe(1);
    expect(m.conversions[0]).toMatchObject({ from: "suggested", reachedFrom: 1, reachedTo: 1, rate: 1 });
  });

  it("partner submissions go to the moderation queue", async () => {
    const id = await submitOpeningAsPartner(partnerCtx, { title: "QA Intern", description: "Test our apps.", remoteMode: "remote", seniority: "intern", skills: [] });
    expect((await prisma.opening.findUniqueOrThrow({ where: { id } })).status).toBe("pending_moderation");
    await expect(submitOpeningAsPartner(cs, {})).rejects.toBeInstanceOf(ForbiddenError);
    await setOpeningStatus(cs, id, "approve");
    expect((await prisma.opening.findUniqueOrThrow({ where: { id } })).status).toBe("open");
  });
});
