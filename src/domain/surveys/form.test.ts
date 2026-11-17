import { describe, expect, it } from "vitest";
import { QUESTIONS_BY_BRANCH, answersToEmployment, branchFor, confirmPrompt, surveyAnswerSchema, type LastKnown } from "./form";

const now = new Date("2026-06-01T00:00:00Z");
const employed: LastKnown = { status: "employed_full_time", companyName: "Acme", roleTitle: "Junior Developer", startDate: new Date("2026-02-01"), inField: true, salaryBand: "band_1000_1500", roleCategory: "frontend" };
const parse = (v: unknown) => surveyAnswerSchema.parse(v);

describe("survey length", () => {
  it("asks fewer than 8 questions on every branch", () => {
    for (const qs of Object.values(QUESTIONS_BY_BRANCH)) expect(qs.length).toBeLessThan(8);
  });
});

describe("branching", () => {
  it.each([
    ["employed_part_time", "employed"],
    ["internship", "employed"],
    ["searching", "searching"],
    ["further_study", "other"],
    ["unchanged", "unchanged"],
  ] as const)("%s → %s", (s, b) => expect(branchFor(s)).toBe(b));
});

describe("confirmPrompt", () => {
  it("asks 'Still at Acme as Junior Developer?' for employed graduates", () => {
    expect(confirmPrompt(employed)).toEqual({ kind: "employed", companyName: "Acme", roleTitle: "Junior Developer" });
  });
  it("asks to confirm the status otherwise, and nothing when unknown", () => {
    expect(confirmPrompt({ ...employed, status: "searching", companyName: null })).toEqual({ kind: "status", status: "searching" });
    expect(confirmPrompt(null)).toBeNull();
    expect(confirmPrompt({ ...employed, status: "unknown" })).toBeNull();
  });
});

describe("answersToEmployment", () => {
  it("copies the last record for 'Yes, nothing changed'", () => {
    const r = answersToEmployment(parse({ mode: "unchanged" }), employed, now);
    expect(r).toEqual({ ok: true, record: expect.objectContaining({ status: "employed_full_time", companyName: "Acme", roleTitle: "Junior Developer", inField: true }) });
  });
  it("refuses 'nothing changed' when there is nothing on record", () => {
    expect(answersToEmployment(parse({ mode: "unchanged" }), null, now).ok).toBe(false);
  });
  it("requires a company on the employed branch and converts the start month", () => {
    expect(answersToEmployment(parse({ mode: "update", status: "employed_full_time" }), null, now)).toEqual({ ok: false, fieldErrors: { companyName: [expect.any(String)] } });
    const r = answersToEmployment(parse({ mode: "update", status: "internship", companyName: " Beta ", startMonth: "2026-04", inField: "no", openToOffers: "yes" }), null, now);
    expect(r).toMatchObject({ ok: true, record: { status: "internship", companyName: "Beta", startDate: new Date("2026-04-01T00:00:00Z"), inField: false }, jobSearchStatus: "open_to_offers" });
  });
  it("rejects absurd future start dates", () => {
    expect(answersToEmployment(parse({ mode: "update", status: "employed_full_time", companyName: "X", startMonth: "2099-01" }), null, now).ok).toBe(false);
  });
  it("captures blockers and help on the searching branch, ignoring employment fields", () => {
    const r = answersToEmployment(parse({ mode: "update", status: "searching", companyName: "ignored", blockers: ["interviews"], helpWanted: ["mock_interview", "none"] }), employed, now);
    expect(r).toEqual({ ok: true, record: { status: "searching", searchBlockers: ["interviews"], helpWanted: ["mock_interview"] }, jobSearchStatus: "active" });
  });
  it("keeps job-search status unchanged for 'nothing changed' and sets not_looking for other statuses", () => {
    const unchanged = answersToEmployment(parse({ mode: "unchanged" }), employed, now);
    expect(unchanged.ok && unchanged.jobSearchStatus).toBeUndefined();
    expect(answersToEmployment(parse({ mode: "update", status: "further_study" }), null, now)).toEqual({ ok: true, record: { status: "further_study" }, jobSearchStatus: "not_looking" });
  });
  it("accepts a single checkbox value (not an array) from form posts", () => {
    expect(parse({ mode: "update", status: "searching", blockers: "time" })).toMatchObject({ blockers: ["time"] });
  });
  it("rejects unknown statuses and options", () => {
    expect(surveyAnswerSchema.safeParse({ mode: "update", status: "astronaut" }).success).toBe(false);
    expect(surveyAnswerSchema.safeParse({ mode: "update", status: "searching", blockers: ["bribery"] }).success).toBe(false);
  });
});
