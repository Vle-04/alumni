/**
 * The check-in survey (also used by the self-update page). Short by design:
 *  - "nothing changed" path: 1 question
 *  - employed path: status, company, role, start month, in-field, salary band (optional), open to offers → 7
 *  - searching path: status, blockers, help wanted → 3
 * Branching is expressed here as data so it can be unit tested and rendered without JS.
 */
import { z } from "zod";
import { SALARY_BANDS, isEmployedStatus, type EmploymentStatus, type SalaryBand } from "../enums";

export const SURVEY_STATUS_OPTIONS = [
  "employed_full_time",
  "employed_part_time",
  "freelance_contract",
  "internship",
  "further_study",
  "searching",
  "not_searching",
] as const satisfies readonly EmploymentStatus[];

export const BLOCKER_OPTIONS = ["experience", "portfolio", "interviews", "few_openings", "location", "time", "other"] as const;
export const HELP_OPTIONS = ["cv_review", "mock_interview", "portfolio_feedback", "introductions", "mentoring", "none"] as const;

export type Branch = "unchanged" | "employed" | "searching" | "other";

/** Questions shown per branch — the brief requires fewer than 8. */
export const QUESTIONS_BY_BRANCH: Record<Branch, readonly string[]> = {
  unchanged: ["confirm"],
  employed: ["status", "companyName", "roleTitle", "startMonth", "inField", "salaryBand", "openToOffers"],
  searching: ["status", "blockers", "helpWanted"],
  other: ["status"],
};

export function branchFor(status: EmploymentStatus | "unchanged"): Branch {
  if (status === "unchanged") return "unchanged";
  if (isEmployedStatus(status)) return "employed";
  if (status === "searching") return "searching";
  return "other";
}

export interface LastKnown {
  status: EmploymentStatus;
  companyName: string | null;
  roleTitle: string | null;
  startDate: Date | null;
  inField: boolean | null;
  salaryBand: SalaryBand | null;
  roleCategory: string | null;
}

export type ConfirmPrompt =
  | { kind: "employed"; companyName: string; roleTitle: string | null }
  | { kind: "status"; status: EmploymentStatus }
  | null;

/** "Still at Acme as Junior Developer?" — or null if there is nothing to confirm. */
export function confirmPrompt(last: LastKnown | null): ConfirmPrompt {
  if (!last || last.status === "unknown") return null;
  if (isEmployedStatus(last.status) && last.companyName) return { kind: "employed", companyName: last.companyName, roleTitle: last.roleTitle };
  return { kind: "status", status: last.status };
}

const trimmed = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v ?? undefined), z.string().max(max).optional());
const month = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM").optional());
const yesNo = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["yes", "no"]).optional());
const list = <T extends readonly [string, ...string[]]>(vals: T) => z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(vals)).max(vals.length));

export const surveyAnswerSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unchanged") }),
  z.object({
    mode: z.literal("update"),
    status: z.enum(SURVEY_STATUS_OPTIONS, { error: "Choose the option that fits best" }),
    companyName: trimmed(150),
    roleTitle: trimmed(150),
    startMonth: month,
    inField: yesNo,
    salaryBand: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(SALARY_BANDS).optional()),
    blockers: list(BLOCKER_OPTIONS),
    helpWanted: list(HELP_OPTIONS),
    openToOffers: yesNo,
  }),
]);
export type SurveyAnswers = z.infer<typeof surveyAnswerSchema>;

export interface EmploymentDraft {
  status: EmploymentStatus;
  companyName?: string;
  roleTitle?: string;
  roleCategory?: string;
  inField?: boolean;
  startDate?: Date;
  salaryBand?: SalaryBand;
  searchBlockers?: string[];
  helpWanted?: string[];
}

export type JobSearchStatus = "active" | "open_to_offers" | "not_looking";
/** `jobSearchStatus` is undefined when it should stay as it is ("nothing changed"). */
export type MapResult = { ok: true; record: EmploymentDraft; jobSearchStatus?: JobSearchStatus } | { ok: false; fieldErrors: Record<string, string[]> };

/** Turns validated answers into an employment record, copying the last record for "nothing changed". */
export function answersToEmployment(a: SurveyAnswers, last: LastKnown | null, now: Date): MapResult {
  if (a.mode === "unchanged") {
    if (!last || last.status === "unknown") return { ok: false, fieldErrors: { status: ["Please tell us your current status"] } };
    return {
      ok: true,
      record: {
        status: last.status,
        companyName: last.companyName ?? undefined,
        roleTitle: last.roleTitle ?? undefined,
        roleCategory: last.roleCategory ?? undefined,
        inField: last.inField ?? undefined,
        startDate: last.startDate ?? undefined,
        salaryBand: last.salaryBand ?? undefined,
      },
    };
  }
  const branch = branchFor(a.status);
  if (branch === "employed") {
    const errors: Record<string, string[]> = {};
    if (!a.companyName) errors.companyName = ["Please enter the company name"];
    const startDate = a.startMonth ? new Date(`${a.startMonth}-01T00:00:00Z`) : undefined;
    if (startDate && startDate.getTime() > now.getTime() + 366 * 86_400_000) errors.startMonth = ["Start month is too far in the future"];
    if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
    return {
      ok: true,
      record: { status: a.status, companyName: a.companyName, roleTitle: a.roleTitle, startDate, inField: a.inField === undefined ? undefined : a.inField === "yes", salaryBand: a.salaryBand },
      jobSearchStatus: a.openToOffers === "yes" ? "open_to_offers" : "not_looking",
    };
  }
  if (branch === "searching") {
    return {
      ok: true,
      record: { status: "searching", searchBlockers: [...a.blockers], helpWanted: a.helpWanted.filter((h) => h !== "none") },
      jobSearchStatus: "active",
    };
  }
  return { ok: true, record: { status: a.status }, jobSearchStatus: "not_looking" };
}
