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
};

export const SETTING_SCHEMAS = { surveys: surveysSchema, matching: matchingSchema } as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<Settings[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  const merged = { ...SETTING_DEFAULTS[key], ...(row.value as object) };
  const parsed = SETTING_SCHEMAS[key].safeParse(merged);
  return parsed.success ? (parsed.data as Settings[K]) : SETTING_DEFAULTS[key];
}
