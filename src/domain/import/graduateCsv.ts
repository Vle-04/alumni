/**
 * Validation for the graduate CSV import. Pure: takes already-parsed rows (header → value)
 * and returns per-row results with field-level errors and duplicate detection by email.
 */
import { z } from "zod";
import {
  EMPLOYMENT_STATUSES,
  REMOTE_PREFERENCES,
  ROLE_CATEGORIES,
  type EmploymentStatus,
  type RemotePreference,
} from "../enums";

export const CSV_COLUMNS = [
  "full_name", "email", "phone", "cohort", "graduation_date", "city", "country", "timezone",
  "remote_preference", "open_to_relocate", "skills", "preferred_roles", "linkedin_url",
  "current_status", "company", "role_title", "in_field", "start_date",
  "consent_outcomes_reporting", "consent_job_matching", "consent_share_with_partners",
] as const;
export const REQUIRED_COLUMNS = ["full_name", "email", "cohort"] as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v);
const optStr = (max: number) => z.preprocess(blankToUndef, z.string().max(max).optional());

const yesNo = z.preprocess(blankToUndef, z.string().optional()).transform((v, ctx) => {
  if (v === undefined) return undefined;
  const s = v.toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  ctx.addIssue({ code: "custom", message: "Use yes or no" });
  return z.NEVER;
});

const isoDate = z.preprocess(blankToUndef, z.string().optional()).transform((v, ctx) => {
  if (v === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    ctx.addIssue({ code: "custom", message: "Use the date format YYYY-MM-DD" });
    return z.NEVER;
  }
  return new Date(`${v}T00:00:00Z`);
});

export interface ParsedSkill {
  name: string;
  level: number;
}

/** "JavaScript:4; React:3; Git" → [{name:"JavaScript",level:4}, …]; level defaults to 3. */
export function parseSkills(input: string | undefined): { skills: ParsedSkill[]; error?: string } {
  if (!input || !input.trim()) return { skills: [] };
  const skills: ParsedSkill[] = [];
  const seen = new Set<string>();
  for (const part of input.split(/[;|]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.+?)(?::\s*([1-5]))?$/.exec(part);
    if (!m || !m[1] || /:/.test(m[1])) return { skills: [], error: `Could not read skill "${part}". Use Name:Level with level 1–5.` };
    const name = m[1].trim();
    if (name.length > 60) return { skills: [], error: `Skill name too long: "${name.slice(0, 20)}…"` };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push({ name, level: m[2] ? Number(m[2]) : 3 });
  }
  return { skills };
}

const rowSchema = z
  .object({
    full_name: z.preprocess(blankToUndef, z.string({ error: "Full name is required" }).min(2, "Full name is too short").max(120)),
    email: z.preprocess(blankToUndef, z.email({ error: "A valid email is required" }).max(254)),
    phone: z.preprocess(blankToUndef, z.string().regex(/^\+?[0-9 ()-]{6,20}$/, "Phone must contain only digits, spaces, +, ( ) or -").optional()),
    cohort: z.preprocess(blankToUndef, z.string({ error: "Cohort is required" }).max(120)),
    graduation_date: isoDate,
    city: optStr(100),
    country: optStr(100),
    timezone: z.preprocess(blankToUndef, z.string().refine(isValidTimeZone, "Unknown time zone (use e.g. Europe/Berlin)").optional()),
    remote_preference: z.preprocess(blankToUndef, z.enum(REMOTE_PREFERENCES, { error: `Use one of: ${REMOTE_PREFERENCES.join(", ")}` }).optional()),
    open_to_relocate: yesNo,
    skills: optStr(1000),
    preferred_roles: optStr(500),
    linkedin_url: z.preprocess(blankToUndef, z.url({ protocol: /^https?$/, error: "LinkedIn URL must start with http(s)://" }).max(300).optional()),
    current_status: z.preprocess(blankToUndef, z.enum(EMPLOYMENT_STATUSES, { error: `Use one of: ${EMPLOYMENT_STATUSES.join(", ")}` }).optional()),
    company: optStr(150),
    role_title: optStr(150),
    in_field: yesNo,
    start_date: isoDate,
    consent_outcomes_reporting: yesNo,
    consent_job_matching: yesNo,
    consent_share_with_partners: yesNo,
  })
  .superRefine((r, ctx) => {
    const employed = r.current_status && ["employed_full_time", "employed_part_time", "freelance_contract", "internship"].includes(r.current_status);
    if (!employed && (r.company || r.role_title)) {
      ctx.addIssue({ code: "custom", path: ["company"], message: "Company/role given but current_status is not an employed status" });
    }
  });

export interface ValidGraduateRow {
  fullName: string;
  email: string; // normalized
  phone?: string;
  cohortName: string;
  graduationDate?: Date;
  city?: string;
  country?: string;
  timezone?: string;
  remotePreference?: RemotePreference;
  openToRelocate?: boolean;
  skills: ParsedSkill[];
  preferredRoles: string[];
  linkedinUrl?: string;
  currentStatus?: EmploymentStatus;
  company?: string;
  roleTitle?: string;
  inField?: boolean;
  startDate?: Date;
  consents: { outcomes_reporting?: boolean; job_matching?: boolean; share_with_partners?: boolean };
}

export interface RowError {
  field: string;
  message: string;
}

export type RowOutcome = "new" | "duplicate_in_file" | "duplicate_existing" | "invalid";

export interface RowResult {
  rowNumber: number; // 1-based data row number (header excluded) — matches spreadsheet row minus 1
  outcome: RowOutcome;
  errors: RowError[];
  data?: ValidGraduateRow;
}

export interface ImportPreview {
  missingColumns: string[];
  unknownColumns: string[];
  rows: RowResult[];
  counts: Record<RowOutcome, number>;
}

export interface ImportContext {
  /** Cohort names that exist (case-insensitive match is applied). */
  cohortNames: readonly string[];
  /** Returns true when a graduate with this normalized email already exists. */
  emailExists: (normalizedEmail: string) => boolean;
}

export function validateGraduateRows(
  headers: readonly string[],
  rows: readonly Record<string, string | undefined>[],
  ctx: ImportContext,
): ImportPreview {
  const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !normalizedHeaders.includes(c));
  const unknownColumns = normalizedHeaders.filter((h) => h && !(CSV_COLUMNS as readonly string[]).includes(h));
  const counts: Record<RowOutcome, number> = { new: 0, duplicate_in_file: 0, duplicate_existing: 0, invalid: 0 };
  if (missingColumns.length > 0) return { missingColumns, unknownColumns, rows: [], counts };

  const cohortByLower = new Map(ctx.cohortNames.map((n) => [n.toLowerCase(), n]));
  const seenEmails = new Map<string, number>();
  const results: RowResult[] = [];

  rows.forEach((raw, i) => {
    const rowNumber = i + 1;
    const row: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(raw)) row[k.trim().toLowerCase()] = v;

    const parsed = rowSchema.safeParse(row);
    const errors: RowError[] = [];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push({ field: String(issue.path[0] ?? "row"), message: issue.message });
    }
    const skills = parseSkills(row.skills);
    if (skills.error) errors.push({ field: "skills", message: skills.error });

    const roles = (row.preferred_roles ?? "").split(/[;|,]/).map((r) => r.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
    const badRole = roles.find((r) => !(ROLE_CATEGORIES as readonly string[]).includes(r));
    if (badRole) errors.push({ field: "preferred_roles", message: `Unknown role category "${badRole}"` });

    let cohortName: string | undefined;
    if (parsed.success) {
      cohortName = cohortByLower.get(parsed.data.cohort.toLowerCase());
      if (!cohortName) errors.push({ field: "cohort", message: `Cohort "${parsed.data.cohort}" does not exist. Create it first.` });
    }

    if (!parsed.success || errors.length > 0) {
      results.push({ rowNumber, outcome: "invalid", errors });
      counts.invalid++;
      return;
    }
    const d = parsed.data;
    const email = normalizeEmail(d.email);
    const data: ValidGraduateRow = {
      fullName: d.full_name,
      email,
      phone: d.phone,
      cohortName: cohortName!,
      graduationDate: d.graduation_date,
      city: d.city,
      country: d.country,
      timezone: d.timezone,
      remotePreference: d.remote_preference,
      openToRelocate: d.open_to_relocate,
      skills: skills.skills,
      preferredRoles: [...new Set(roles)],
      linkedinUrl: d.linkedin_url,
      currentStatus: d.current_status,
      company: d.company,
      roleTitle: d.role_title,
      inField: d.in_field,
      startDate: d.start_date,
      consents: {
        outcomes_reporting: d.consent_outcomes_reporting,
        job_matching: d.consent_job_matching,
        share_with_partners: d.consent_share_with_partners,
      },
    };

    const firstSeen = seenEmails.get(email);
    if (firstSeen !== undefined) {
      results.push({ rowNumber, outcome: "duplicate_in_file", errors: [{ field: "email", message: `Same email as row ${firstSeen}` }], data });
      counts.duplicate_in_file++;
      return;
    }
    seenEmails.set(email, rowNumber);
    if (ctx.emailExists(email)) {
      results.push({ rowNumber, outcome: "duplicate_existing", errors: [{ field: "email", message: "A graduate with this email already exists" }], data });
      counts.duplicate_existing++;
      return;
    }
    results.push({ rowNumber, outcome: "new", errors: [], data });
    counts.new++;
  });

  return { missingColumns, unknownColumns, rows: results, counts };
}
