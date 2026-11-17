/**
 * Explainable, deterministic matching of graduates to openings.
 *
 * HARD FILTERS (all must pass):
 *   1. status is "searching", or the graduate opted in as "open to offers"
 *   2. job-matching consent is granted
 *   3. location / remote compatible
 *   4. every must-have skill is present
 *
 * SCORE 0–100 (weights configurable, default 60/15/15/10):
 *   skills   = Σ(weight × level/5) ÷ Σ weight over the opening's skills (missing skill → 0)
 *   role     = 1 preferred role category matches · 0.5 no preferences given · 0 otherwise
 *   location = 1 remote-compatible or same city · 0.8 opening has no city · 0.5 needs relocation
 *   boost    = max(recent-graduate boost, long-search boost) so nobody is permanently overlooked
 *
 * Inputs contain NO protected attributes (age, gender, nationality, photo…); the candidate type
 * is a closed list of fields — see MATCH_CANDIDATE_FIELDS.
 */
import type { EmploymentStatus, JobSearchStatus, RemoteMode, RemotePreference } from "../enums";
import { DAY_MS } from "../stats/basic";

export interface OpeningSkillReq {
  skillId: string;
  name: string;
  weight: number; // 1–5 importance
  mustHave: boolean;
}

export interface MatchOpening {
  id: string;
  title: string;
  roleCategory: string | null;
  city: string | null;
  country: string | null;
  remoteMode: RemoteMode;
  skills: readonly OpeningSkillReq[];
}

export interface MatchCandidate {
  id: string;
  currentStatus: EmploymentStatus;
  jobSearchStatus: JobSearchStatus;
  jobMatchingConsent: boolean;
  remotePreference: RemotePreference;
  openToRelocate: boolean;
  city: string | null;
  country: string | null;
  preferredRoleCategories: readonly string[];
  skills: ReadonlyMap<string, number>; // canonical skill id → self-rated level 1–5
  graduationDate: Date | null;
  searchingSince: Date | null;
}

/** The only fields matching may ever read. Guarded by a unit test. */
export const MATCH_CANDIDATE_FIELDS = [
  "id", "currentStatus", "jobSearchStatus", "jobMatchingConsent", "remotePreference", "openToRelocate",
  "city", "country", "preferredRoleCategories", "skills", "graduationDate", "searchingSince",
] as const satisfies readonly (keyof MatchCandidate)[];

export interface MatchConfig {
  weights: { skills: number; role: number; location: number; boost: number };
  /** Graduates within this many days of graduation get a boost that fades linearly to 0. */
  recentGraduateDays: number;
  /** Searching at least this long starts a boost of 0.5, rising to 1 at `longSearchFullDays`. */
  longSearchDays: number;
  longSearchFullDays: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  weights: { skills: 60, role: 15, location: 15, boost: 10 },
  recentGraduateDays: 90,
  longSearchDays: 60,
  longSearchFullDays: 180,
};

export type ExclusionReason = "not_searching" | "no_matching_consent" | "location" | "missing_must_have";

export interface MatchBreakdown {
  skills: number; // 0–1
  role: number;
  location: number;
  boost: number;
  matchedSkills: string[];
  missingSkills: string[];
  daysSearching: number | null;
  daysSinceGraduation: number | null;
}

export interface MatchResult {
  candidateId: string;
  openingId: string;
  score: number; // integer 0–100
  breakdown: MatchBreakdown;
  explanation: string[];
}

export type Evaluation = { eligible: true; result: MatchResult } | { eligible: false; candidateId: string; openingId: string; reasons: ExclusionReason[]; explanation: string[] };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function locationFit(o: MatchOpening, c: MatchCandidate): { ok: boolean; fit: number; text: string } {
  if (o.remoteMode === "remote") {
    return c.remotePreference === "onsite" ? { ok: true, fit: 0.7, text: "Remote role (prefers on-site)." } : { ok: true, fit: 1, text: "Remote OK." };
  }
  if (c.remotePreference === "remote_only") return { ok: false, fit: 0, text: `Wants remote only; this role is ${o.remoteMode === "hybrid" ? "hybrid" : "on-site"}.` };
  if (!o.city) return { ok: true, fit: 0.8, text: "No location given for this role." };
  if (norm(c.city) === norm(o.city)) return { ok: true, fit: 1, text: `Same city (${o.city}).` };
  if (c.openToRelocate) return { ok: true, fit: 0.5, text: `Would need to relocate to ${o.city} (open to relocating).` };
  return { ok: false, fit: 0, text: `Based ${c.city ? `in ${c.city}` : "elsewhere"}; role is in ${o.city} and not open to relocating.` };
}

function boostFor(c: MatchCandidate, cfg: MatchConfig, now: Date) {
  const daysSinceGraduation = c.graduationDate ? Math.floor((now.getTime() - c.graduationDate.getTime()) / DAY_MS) : null;
  const daysSearching = c.searchingSince ? Math.floor((now.getTime() - c.searchingSince.getTime()) / DAY_MS) : null;
  const recent = daysSinceGraduation !== null && daysSinceGraduation >= 0 && daysSinceGraduation <= cfg.recentGraduateDays ? 1 - daysSinceGraduation / cfg.recentGraduateDays : 0;
  const long =
    daysSearching !== null && daysSearching >= cfg.longSearchDays
      ? 0.5 + 0.5 * clamp01((daysSearching - cfg.longSearchDays) / Math.max(1, cfg.longSearchFullDays - cfg.longSearchDays))
      : 0;
  return { boost: Math.max(recent, long), recent, long, daysSinceGraduation, daysSearching };
}

export function evaluate(o: MatchOpening, c: MatchCandidate, cfg: MatchConfig = DEFAULT_MATCH_CONFIG, now: Date = new Date()): Evaluation {
  const reasons: ExclusionReason[] = [];
  const why: string[] = [];
  if (!(c.currentStatus === "searching" || c.jobSearchStatus === "open_to_offers")) {
    reasons.push("not_searching");
    why.push("Not searching and not open to offers.");
  }
  if (!c.jobMatchingConsent) {
    reasons.push("no_matching_consent");
    why.push("Has not agreed to job matching.");
  }
  const loc = locationFit(o, c);
  if (!loc.ok) {
    reasons.push("location");
    why.push(loc.text);
  }
  const missingMust = o.skills.filter((s) => s.mustHave && !c.skills.has(s.skillId)).map((s) => s.name);
  if (missingMust.length) {
    reasons.push("missing_must_have");
    why.push(`Missing must-have skill${missingMust.length > 1 ? "s" : ""}: ${missingMust.join(", ")}.`);
  }
  if (reasons.length) return { eligible: false, candidateId: c.id, openingId: o.id, reasons, explanation: why };

  // Skills
  const totalWeight = o.skills.reduce((a, s) => a + s.weight, 0);
  const matched = o.skills.filter((s) => c.skills.has(s.skillId));
  const missing = o.skills.filter((s) => !c.skills.has(s.skillId)).map((s) => s.name);
  const skills = totalWeight === 0 ? 1 : o.skills.reduce((a, s) => a + s.weight * ((c.skills.get(s.skillId) ?? 0) / 5), 0) / totalWeight;

  // Role
  const role = c.preferredRoleCategories.length === 0 ? 0.5 : o.roleCategory && c.preferredRoleCategories.includes(o.roleCategory) ? 1 : 0;

  const b = boostFor(c, cfg, now);
  const w = cfg.weights;
  const score = Math.round(w.skills * skills + w.role * role + w.location * loc.fit + w.boost * b.boost);

  const explanation: string[] = [];
  if (o.skills.length === 0) explanation.push("No skills listed for this opening.");
  else explanation.push(`Matches ${matched.length} of ${o.skills.length} required skills${missing.length ? `; missing: ${missing.join(", ")}` : ""}.`);
  if (matched.length) explanation.push(`Skill levels: ${matched.map((s) => `${s.name} ${c.skills.get(s.skillId)}/5`).join(", ")}.`);
  explanation.push(role === 1 ? "Preferred role matches." : role === 0.5 ? "No role preference given." : "Not one of the preferred roles.");
  explanation.push(loc.text);
  if (b.long > 0 && b.long >= b.recent) explanation.push(`Searching for ${b.daysSearching} days — priority boost.`);
  else if (b.recent > 0) explanation.push(`Graduated ${b.daysSinceGraduation} days ago — recent-graduate boost.`);

  return {
    eligible: true,
    result: {
      candidateId: c.id,
      openingId: o.id,
      score: Math.max(0, Math.min(100, score)),
      breakdown: { skills, role, location: loc.fit, boost: b.boost, matchedSkills: matched.map((s) => s.name), missingSkills: missing, daysSearching: b.daysSearching, daysSinceGraduation: b.daysSinceGraduation },
      explanation,
    },
  };
}

/** Deterministic order: score ↓, then longer searching first, then id ↑. */
function compare(a: MatchResult, b: MatchResult): number {
  return b.score - a.score || (b.breakdown.daysSearching ?? -1) - (a.breakdown.daysSearching ?? -1) || a.candidateId.localeCompare(b.candidateId) || a.openingId.localeCompare(b.openingId);
}

export interface Ranking {
  ranked: MatchResult[];
  excluded: { id: string; reasons: ExclusionReason[]; explanation: string[] }[];
  excludedByReason: Record<ExclusionReason, number>;
}

function summarize(evals: Evaluation[], idOf: (e: Evaluation) => string): Ranking {
  const ranked = evals.flatMap((e) => (e.eligible ? [e.result] : [])).sort(compare);
  const excluded = evals.flatMap((e) => (e.eligible ? [] : [{ id: idOf(e), reasons: e.reasons, explanation: e.explanation }]));
  const excludedByReason: Record<ExclusionReason, number> = { not_searching: 0, no_matching_consent: 0, location: 0, missing_must_have: 0 };
  for (const x of excluded) for (const r of x.reasons) excludedByReason[r]++;
  return { ranked, excluded, excludedByReason };
}

export function rankCandidates(o: MatchOpening, candidates: readonly MatchCandidate[], cfg = DEFAULT_MATCH_CONFIG, now = new Date()): Ranking {
  return summarize(candidates.map((c) => evaluate(o, c, cfg, now)), (e) => (e.eligible ? e.result.candidateId : e.candidateId));
}

export function rankOpenings(c: MatchCandidate, openings: readonly MatchOpening[], cfg = DEFAULT_MATCH_CONFIG, now = new Date()): Ranking {
  return summarize(openings.map((o) => evaluate(o, c, cfg, now)), (e) => (e.eligible ? e.result.openingId : e.openingId));
}
