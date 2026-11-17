/**
 * Admin-configurable settings, stored as JSON in the Setting table and merged over defaults.
 * Read fresh on every use (cheap, and changes apply immediately).
 */
import { z } from "zod";
import type { Db } from "./db";
import { prisma } from "./db";

const surveysSchema = z.object({
  skipWindowDays: z.number().int().min(0).max(90),
  missedGraceDays: z.number().int().min(0).max(90),
  sendHourUtc: z.number().int().min(0).max(23),
  reminderOffsetsDays: z.array(z.number().int().min(1).max(60)).max(5),
  quietHours: z.object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(0).max(23) }),
});

const matchingSchema = z.object({
  weights: z.object({ skills: z.number().min(0).max(100), role: z.number().min(0).max(100), location: z.number().min(0).max(100), boost: z.number().min(0).max(100) })
    .refine((w) => w.skills + w.role + w.location + w.boost === 100, "Weights must add up to 100"),
  recentGraduateDays: z.number().int().min(0).max(365),
  longSearchDays: z.number().int().min(0).max(365),
  longSearchFullDays: z.number().int().min(1).max(730),
});

const EMPLOYMENT = ["employed_full_time", "employed_part_time", "freelance_contract", "internship", "further_study", "searching", "not_searching"] as const;
const reportingSchema = z.object({
  employedStatuses: z.array(z.enum(EMPLOYMENT)).min(1),
  qualifyingJobStatuses: z.array(z.enum(EMPLOYMENT)).min(1),
  windowBeforeDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(365),
  minCell: z.number().int().min(5).max(50), // never below 5
  freshnessDays: z.number().int().min(1).max(365),
});

const retentionSchema = z.object({
  anonymizeAfterYears: z.number().int().min(1).max(50),
  auditLogDays: z.number().int().min(90).max(3650),
  emailLogDays: z.number().int().min(7).max(3650),
});

export const SETTING_DEFAULTS = {
  surveys: {
    skipWindowDays: 14,
    missedGraceDays: 14,
    sendHourUtc: 9,
    reminderOffsetsDays: [4, 10],
    quietHours: { startHour: 21, endHour: 8 },
  } satisfies z.infer<typeof surveysSchema>,
  matching: {
    weights: { skills: 60, role: 15, location: 15, boost: 10 },
    recentGraduateDays: 90,
    longSearchDays: 60,
    longSearchFullDays: 180,
  } satisfies z.infer<typeof matchingSchema>,
  reporting: {
    employedStatuses: ["employed_full_time", "employed_part_time", "freelance_contract", "internship"],
    qualifyingJobStatuses: ["employed_full_time", "employed_part_time", "freelance_contract"],
    windowBeforeDays: 90,
    graceDays: 45,
    minCell: 5,
    freshnessDays: 90,
  } as z.infer<typeof reportingSchema>,
  retention: { anonymizeAfterYears: 5, auditLogDays: 3 * 365, emailLogDays: 90 } satisfies z.infer<typeof retentionSchema>,
};

export const SETTING_SCHEMAS = { surveys: surveysSchema, matching: matchingSchema, reporting: reportingSchema, retention: retentionSchema } as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<Settings[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  const merged = { ...SETTING_DEFAULTS[key], ...(row.value as object) };
  const parsed = SETTING_SCHEMAS[key].safeParse(merged);
  return parsed.success ? (parsed.data as Settings[K]) : SETTING_DEFAULTS[key];
}

/** Admin: replaces one settings section after validation. */
export async function saveSetting<K extends SettingKey>(key: K, value: unknown, db: Db = prisma): Promise<Settings[K]> {
  const parsed = SETTING_SCHEMAS[key].parse(value) as Settings[K];
  await db.setting.upsert({ where: { key }, create: { key, value: parsed as object }, update: { value: parsed as object } });
  return parsed;
}
