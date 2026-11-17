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

export const SETTING_DEFAULTS = {
  surveys: {
    skipWindowDays: 14,
    missedGraceDays: 14,
    sendHourUtc: 9,
    reminderOffsetsDays: [4, 10],
    quietHours: { startHour: 21, endHour: 8 },
  } satisfies z.infer<typeof surveysSchema>,
};

export const SETTING_SCHEMAS = { surveys: surveysSchema } as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<Settings[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  const merged = { ...SETTING_DEFAULTS[key], ...(row.value as object) };
  const parsed = SETTING_SCHEMAS[key].safeParse(merged);
  return parsed.success ? (parsed.data as Settings[K]) : SETTING_DEFAULTS[key];
}
