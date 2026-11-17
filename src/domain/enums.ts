/**
 * Shared domain vocabularies. Mirrors the Prisma enums but has no dependency on Prisma,
 * so domain modules stay framework-independent.
 */
export const EMPLOYMENT_STATUSES = [
  "employed_full_time",
  "employed_part_time",
  "freelance_contract",
  "internship",
  "further_study",
  "searching",
  "not_searching",
  "unknown",
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/** Statuses that count as "employed" by default in outcome metrics (each configurable). */
export const EMPLOYED_STATUSES = [
  "employed_full_time",
  "employed_part_time",
  "freelance_contract",
  "internship",
] as const satisfies readonly EmploymentStatus[];

export function isEmployedStatus(s: EmploymentStatus): boolean {
  return (EMPLOYED_STATUSES as readonly string[]).includes(s);
}

export const JOB_SEARCH_STATUSES = ["active", "open_to_offers", "not_looking"] as const;
export type JobSearchStatus = (typeof JOB_SEARCH_STATUSES)[number];

export const REMOTE_PREFERENCES = ["remote_only", "hybrid", "onsite", "any"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

export const REMOTE_MODES = ["remote", "hybrid", "onsite"] as const;
export type RemoteMode = (typeof REMOTE_MODES)[number];

export const SALARY_BANDS = [
  "band_0_500",
  "band_500_1000",
  "band_1000_1500",
  "band_1500_2500",
  "band_2500_4000",
  "band_4000_plus",
  "prefer_not_to_say",
] as const;
export type SalaryBand = (typeof SALARY_BANDS)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship", "other"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const CONSENT_PURPOSES = [
  "outcomes_reporting",
  "job_matching",
  "share_with_partners",
  "marketing_testimonial",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const REFERRAL_STATUSES = [
  "suggested",
  "graduate_interested",
  "referred",
  "interviewing",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const MILESTONES = [1, 3, 6, 12] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Role categories used for preferences, openings and reporting. Editable later via settings. */
export const ROLE_CATEGORIES = [
  "software_engineering",
  "frontend",
  "backend",
  "data_analytics",
  "data_science",
  "qa_testing",
  "devops_cloud",
  "ui_ux_design",
  "product_project",
  "it_support",
  "other",
] as const;
export type RoleCategory = (typeof ROLE_CATEGORIES)[number];
