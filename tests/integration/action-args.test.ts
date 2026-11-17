/** Audit item 3 (runtime): tampered server-action arguments are rejected by Zod before anything runs. */
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { notifyAction, openingStatusAction } from "@/app/(staff)/openings/actions";
import { moveReferralAction } from "@/app/(staff)/referrals/actions";
import { saveSettingsAction } from "@/app/(staff)/admin/settings/actions";
import { respondToMatchAction, setSubscriptionAction } from "@/app/(graduate)/me/actions";
import { logChartExportAction } from "@/app/(staff)/reports/actions";

describe("server actions reject tampered arguments", () => {
  it.each([
    ["id with SQL-ish content", () => notifyAction("x'; DROP TABLE x;--", "abc")],
    ["prototype key as status action", () => openingStatusAction("abc", "constructor" as never)],
    ["unknown referral stage", () => moveReferralAction("abc", "hacked")],
    ["too-long note", () => moveReferralAction("abc", "referred", "x".repeat(501))],
    ["extra argument (AUDIT 19)", () => (moveReferralAction as (...a: unknown[]) => Promise<unknown>)("abc", "referred", "note", "extra")],
    ["unknown settings key", () => saveSettingsAction("__proto__" as never, null as never, new FormData())],
    ["non-FormData form", () => saveSettingsAction("surveys", null as never, { skipWindowDays: 1 } as never)],
    ["bad match response", () => respondToMatchAction("abc", "maybe" as never)],
    ["string instead of boolean", () => setSubscriptionAction("false" as never)],
    ["AUDIT 17: chart filters with an unknown key", () => logChartExportAction("cohort-comparison", { cohortId: "abc", evil: "<script>" })],
    ["AUDIT 17: chart filters with a bad month", () => logChartExportAction("cohort-comparison", { from: "2025-13" })],
    ["AUDIT 17: oversized chart filters", () => logChartExportAction("cohort-comparison", { cohortId: "a".repeat(2000) })],
    ["AUDIT 17: bad chart name", () => logChartExportAction("../etc", {})],
  ])("%s", async (_n, call) => {
    await expect(call()).rejects.toBeInstanceOf(ZodError);
  });
});
