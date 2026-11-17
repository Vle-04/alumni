import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { SETTING_DEFAULTS, getSetting, saveSetting, type SettingKey } from "../settings";

export async function getAllSettings(ctx: RequestContext) {
  requirePermission(ctx, "settings:manage");
  const keys = Object.keys(SETTING_DEFAULTS) as SettingKey[];
  return Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await getSetting(k)]))) as { [K in SettingKey]: Awaited<ReturnType<typeof getSetting<K>>> };
}

export async function updateSettings(ctx: RequestContext, rawKey: unknown, value: unknown) {
  requirePermission(ctx, "settings:manage");
  const key = z.enum(Object.keys(SETTING_DEFAULTS) as [SettingKey, ...SettingKey[]]).parse(rawKey);
  const before = await getSetting(key);
  const after = await saveSetting(key, value);
  await audit(prisma, ctx, { action: "settings.update", entityType: "Setting", entityId: key, before: before as Record<string, unknown>, after: after as Record<string, unknown> });
}
