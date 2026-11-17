"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { updateSettings } from "@/server/services/settings-admin";
import type { SettingKey } from "@/server/settings";

const num = (fd: FormData, k: string) => Number(fd.get(k));
const list = (fd: FormData, k: string) => String(fd.get(k) ?? "").split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x) && String(x) !== "");

function parse(key: SettingKey, fd: FormData): unknown {
  switch (key) {
    case "surveys":
      return { skipWindowDays: num(fd, "skipWindowDays"), missedGraceDays: num(fd, "missedGraceDays"), sendHourUtc: num(fd, "sendHourUtc"), reminderOffsetsDays: list(fd, "reminderOffsetsDays"), quietHours: { startHour: num(fd, "quietStart"), endHour: num(fd, "quietEnd") } };
    case "matching":
      return { weights: { skills: num(fd, "wSkills"), role: num(fd, "wRole"), location: num(fd, "wLocation"), boost: num(fd, "wBoost") }, recentGraduateDays: num(fd, "recentGraduateDays"), longSearchDays: num(fd, "longSearchDays"), longSearchFullDays: num(fd, "longSearchFullDays") };
    case "reporting":
      return { employedStatuses: fd.getAll("employedStatuses"), qualifyingJobStatuses: fd.getAll("qualifyingJobStatuses"), windowBeforeDays: num(fd, "windowBeforeDays"), graceDays: num(fd, "graceDays"), minCell: num(fd, "minCell"), freshnessDays: num(fd, "freshnessDays") };
    case "retention":
      return { anonymizeAfterYears: num(fd, "anonymizeAfterYears"), auditLogDays: num(fd, "auditLogDays"), emailLogDays: num(fd, "emailLogDays") };
    default:
      return undefined; // unknown key → rejected by updateSettings
  }
}

export async function saveSettingsAction(key: SettingKey, _p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => {
    const ctx = await staffActionContext("settings:manage");
    await updateSettings(ctx, key, parse(key, fd));
    return null;
  }, "Saved. Takes effect immediately.");
  revalidatePath("/admin/settings");
  return r;
}
