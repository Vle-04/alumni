import { describe, expect, it } from "vitest";
import { buildSkillDictionary, resolveSkill } from "../skills/normalize";
import { DEFAULT_MATCH_CONFIG, MATCH_CANDIDATE_FIELDS, evaluate, rankCandidates, rankOpenings, type MatchCandidate, type MatchOpening } from "./match";

const now = new Date("2026-06-01T00:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

const opening: MatchOpening = {
  id: "o1", title: "Junior Frontend Developer", roleCategory: "frontend", city: "Berlin", country: "Germany", remoteMode: "hybrid",
  skills: [
    { skillId: "js", name: "JavaScript", weight: 5, mustHave: true },
    { skillId: "react", name: "React", weight: 4, mustHave: false },
    { skillId: "css", name: "CSS", weight: 2, mustHave: false },
    { skillId: "git", name: "Git", weight: 2, mustHave: false },
    { skillId: "docker", name: "Docker", weight: 2, mustHave: false },
  ],
};

const cand = (o: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: "c1", currentStatus: "searching", jobSearchStatus: "active", jobMatchingConsent: true, remotePreference: "any", openToRelocate: false,
  city: "Berlin", country: "Germany", preferredRoleCategories: ["frontend"],
  skills: new Map([["js", 4], ["react", 3], ["css", 5], ["git", 4]]), graduationDate: days(200), searchingSince: days(30), ...o,
});

describe("hard filters", () => {
  it("excludes graduates who are not searching unless open to offers", () => {
    expect(evaluate(opening, cand({ currentStatus: "employed_full_time", jobSearchStatus: "not_looking" }), DEFAULT_MATCH_CONFIG, now)).toMatchObject({ eligible: false, reasons: ["not_searching"] });
    expect(evaluate(opening, cand({ currentStatus: "employed_full_time", jobSearchStatus: "open_to_offers" }), DEFAULT_MATCH_CONFIG, now).eligible).toBe(true);
  });
  it("requires job-matching consent", () => {
    expect(evaluate(opening, cand({ jobMatchingConsent: false }), DEFAULT_MATCH_CONFIG, now)).toMatchObject({ eligible: false, reasons: ["no_matching_consent"] });
  });
  it("checks location: remote-only vs on-site, other city, relocation", () => {
    expect(evaluate(opening, cand({ remotePreference: "remote_only" }), DEFAULT_MATCH_CONFIG, now)).toMatchObject({ eligible: false, reasons: ["location"] });
    expect(evaluate(opening, cand({ city: "Lisbon" }), DEFAULT_MATCH_CONFIG, now)).toMatchObject({ eligible: false, reasons: ["location"] });
    const relocate = evaluate(opening, cand({ city: "Lisbon", openToRelocate: true }), DEFAULT_MATCH_CONFIG, now);
    expect(relocate.eligible && relocate.result.breakdown.location).toBe(0.5);
    const remote = evaluate({ ...opening, remoteMode: "remote" }, cand({ city: "Lisbon", remotePreference: "remote_only" }), DEFAULT_MATCH_CONFIG, now);
    expect(remote.eligible && remote.result.explanation).toContain("Remote OK.");
  });
  it("requires every must-have skill", () => {
    const r = evaluate(opening, cand({ skills: new Map([["react", 5]]) }), DEFAULT_MATCH_CONFIG, now);
    expect(r).toMatchObject({ eligible: false, reasons: ["missing_must_have"], explanation: ["Missing must-have skill: JavaScript."] });
  });
  it("reports every failing filter at once", () => {
    const r = evaluate(opening, cand({ currentStatus: "not_searching", jobSearchStatus: "not_looking", jobMatchingConsent: false, city: "Oslo", skills: new Map() }), DEFAULT_MATCH_CONFIG, now);
    expect(r.eligible === false && r.reasons).toEqual(["not_searching", "no_matching_consent", "location", "missing_must_have"]);
  });
});

describe("score and explanation", () => {
  it("computes weighted skill coverage × level and explains it in plain language", () => {
    const r = evaluate(opening, cand(), DEFAULT_MATCH_CONFIG, now);
    if (!r.eligible) throw new Error("expected eligible");
    // skills = (5·4/5 + 4·3/5 + 2·5/5 + 2·4/5 + 2·0) / 15 = (4 + 2.4 + 2 + 1.6) / 15 = 0.6667
    expect(r.result.breakdown.skills).toBeCloseTo(0.6667, 3);
    // 60·0.6667 + 15·1 + 15·1 + 10·0 = 70
    expect(r.result.score).toBe(70);
    expect(r.result.explanation[0]).toBe("Matches 4 of 5 required skills; missing: Docker.");
    expect(r.result.explanation).toContain("Same city (Berlin).");
    expect(r.result.explanation).toContain("Preferred role matches.");
  });

  it("is deterministic", () => {
    expect(evaluate(opening, cand(), DEFAULT_MATCH_CONFIG, now)).toEqual(evaluate(opening, cand(), DEFAULT_MATCH_CONFIG, now));
  });

  it("handles openings with no skills and candidates with no skills", () => {
    const none = evaluate({ ...opening, skills: [] }, cand({ skills: new Map() }), DEFAULT_MATCH_CONFIG, now);
    expect(none.eligible && none.result.breakdown.skills).toBe(1);
    expect(none.eligible && none.result.explanation[0]).toBe("No skills listed for this opening.");
    const noSkills = evaluate({ ...opening, skills: opening.skills.map((s) => ({ ...s, mustHave: false })) }, cand({ skills: new Map() }), DEFAULT_MATCH_CONFIG, now);
    expect(noSkills.eligible && noSkills.result.breakdown.skills).toBe(0);
  });

  it("gives neutral role credit when no preferences are given and none for a different role", () => {
    const a = evaluate(opening, cand({ preferredRoleCategories: [] }), DEFAULT_MATCH_CONFIG, now);
    const b = evaluate(opening, cand({ preferredRoleCategories: ["backend"] }), DEFAULT_MATCH_CONFIG, now);
    expect(a.eligible && a.result.breakdown.role).toBe(0.5);
    expect(b.eligible && b.result.breakdown.role).toBe(0);
  });

  it("boosts recent graduates and long-searching graduates so nobody is permanently overlooked", () => {
    const base = evaluate(opening, cand(), DEFAULT_MATCH_CONFIG, now);
    const recent = evaluate(opening, cand({ graduationDate: days(9), searchingSince: days(5) }), DEFAULT_MATCH_CONFIG, now);
    const long = evaluate(opening, cand({ searchingSince: days(180) }), DEFAULT_MATCH_CONFIG, now);
    if (!base.eligible || !recent.eligible || !long.eligible) throw new Error();
    expect(recent.result.breakdown.boost).toBeCloseTo(0.9);
    expect(recent.result.explanation.at(-1)).toBe("Graduated 9 days ago — recent-graduate boost.");
    expect(long.result.breakdown.boost).toBe(1);
    expect(long.result.explanation.at(-1)).toBe("Searching for 180 days — priority boost.");
    expect(long.result.score).toBe(base.result.score + 10);
  });

  it("respects configurable weights", () => {
    const cfg = { ...DEFAULT_MATCH_CONFIG, weights: { skills: 100, role: 0, location: 0, boost: 0 } };
    const r = evaluate(opening, cand(), cfg, now);
    expect(r.eligible && r.result.score).toBe(67);
  });

  it("scores stay within 0–100", () => {
    const perfect = evaluate(opening, cand({ skills: new Map(opening.skills.map((s) => [s.skillId, 5])), searchingSince: days(400) }), DEFAULT_MATCH_CONFIG, now);
    expect(perfect.eligible && perfect.result.score).toBe(100);
  });
});

describe("ranking", () => {
  it("ranks by score, then longest searching, then id (ties are deterministic)", () => {
    const r = rankCandidates(opening, [
      cand({ id: "b" }),
      cand({ id: "a" }),
      cand({ id: "z", skills: new Map([["js", 5], ["react", 5], ["css", 5], ["git", 5], ["docker", 5]]) }),
      cand({ id: "c", searchingSince: days(45) }),
      cand({ id: "x", jobMatchingConsent: false }),
    ], DEFAULT_MATCH_CONFIG, now);
    expect(r.ranked.map((m) => m.candidateId)).toEqual(["z", "c", "a", "b"]);
    expect(r.excluded.map((e) => e.id)).toEqual(["x"]);
    expect(r.excludedByReason.no_matching_consent).toBe(1);
  });

  it("returns an empty ranking when every candidate fails the filters", () => {
    const r = rankCandidates(opening, [cand({ jobMatchingConsent: false }), cand({ id: "c2", currentStatus: "not_searching", jobSearchStatus: "not_looking" })], DEFAULT_MATCH_CONFIG, now);
    expect(r.ranked).toEqual([]);
    expect(r.excluded).toHaveLength(2);
  });

  it("ranks openings for a graduate", () => {
    const other: MatchOpening = { ...opening, id: "o2", roleCategory: "backend", skills: [{ skillId: "js", name: "JavaScript", weight: 3, mustHave: false }] };
    const r = rankOpenings(cand(), [other, opening], DEFAULT_MATCH_CONFIG, now);
    expect(r.ranked.map((m) => m.openingId)).toEqual(["o1", "o2"]);
  });
});

describe("synonyms", () => {
  it("matches a skill typed as a synonym ('JS', 'Postgres') to the opening's canonical skill", () => {
    const dict = buildSkillDictionary([{ id: "js", canonicalName: "JavaScript" }, { id: "pg", canonicalName: "PostgreSQL" }], [{ skillId: "js", alias: "js" }, { skillId: "pg", alias: "postgres" }]);
    const typed = [["JS", 4], ["Postgres", 3]] as const;
    const skills = new Map(typed.map(([n, l]) => [resolveSkill(dict, n)!, l]));
    const o: MatchOpening = { ...opening, skills: [{ skillId: "js", name: "JavaScript", weight: 3, mustHave: true }, { skillId: "pg", name: "PostgreSQL", weight: 3, mustHave: true }] };
    const r = evaluate(o, cand({ skills }), DEFAULT_MATCH_CONFIG, now);
    expect(r.eligible && r.result.explanation[0]).toBe("Matches 2 of 2 required skills.");
  });
});

describe("no protected attributes", () => {
  it("the candidate input is a closed list of non-protected fields", () => {
    expect([...MATCH_CANDIDATE_FIELDS].sort()).toEqual(Object.keys(cand()).sort());
    for (const f of MATCH_CANDIDATE_FIELDS) expect(f).not.toMatch(/age|birth|gender|sex|nation|ethnic|religion|photo|marital|disab/i);
  });
});
