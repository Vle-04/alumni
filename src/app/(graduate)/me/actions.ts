"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CONSENT_PURPOSES } from "@/domain/enums";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { getGraduateContext } from "@/server/graduate-session";
import { UnauthenticatedError } from "@/server/errors";
import * as self from "@/server/services/self-service";
import { requestClientIp } from "@/server/rate-limit";

async function ctx() {
  const c = await getGraduateContext();
  if (!c) throw new UnauthenticatedError();
  return c;
}
const SESSION_MSG = "Your session expired. Please open the link from your email again.";
const fix = <T,>(r: ActionResult<T>): ActionResult<T> => (!r.ok && r.error === "Please sign in." ? { ...r, error: SESSION_MSG } : r);
const SURVEY_OPTS = { arrays: ["blockers", "helpWanted"] };

export async function submitSurveyAction(...args: [surveyId: string, _p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [surveyId, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const r = fix(await runAction(async () => { await self.submitSurvey(await ctx(), surveyId, formToObject(fd, SURVEY_OPTS)); return null; }));
  if (r.ok) redirect("/me/thanks");
  return r;
}

export async function submitSelfUpdateAction(...args: [_p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = fix(await runAction(async () => { await self.submitSelfUpdate(await ctx(), formToObject(fd, SURVEY_OPTS)); return null; }));
  if (r.ok) redirect("/me/thanks");
  return r;
}

export async function updatePreferencesAction(...args: [_p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = fix(await runAction(async () => { await self.updatePreferences(await ctx(), formToObject(fd, { arrays: ["preferredRoleCategories"], booleans: ["openToRelocate"], json: ["skills"] })); return null; }, "Preferences saved."));
  revalidatePath("/me");
  return r;
}

export async function updateConsentsAction(...args: [_p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const granted = Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, fd.get(p) === "on"]));
  const r = fix(await runAction(async () => { await self.updateConsents(await ctx(), granted); return null; }, "Your privacy choices are saved."));
  revalidatePath("/me");
  return r;
}

export async function setSubscriptionAction(...args: [subscribed: boolean]) {
  const [subscribed] = parseArgs(z.tuple([z.boolean(), A.form.optional()]), args);
  await runAction(async () => self.setEmailSubscription(await ctx(), subscribed === true));
  revalidatePath("/me");
}

export async function requestEmailCodeAction(...args: [_formData?: FormData]): Promise<ActionResult<null>> {
  parseArgs(z.tuple([]), args);
  return fix(await runAction(async () => { await self.requestOtp(await ctx(), "change_email"); return null; }));
}

export async function changeEmailAction(...args: [_p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = fix(await runAction(async () => { await self.changeEmail(await ctx(), formToObject(fd)); return null; }, "Your email is updated."));
  revalidatePath("/me");
  return r;
}

export async function requestNewLinkAction(...args: [_p: { status?: string }, fd: FormData]): Promise<{ status: "sent" | "rate_limited" }> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const ip = await requestClientIp();
  if (!ip) return { status: "rate_limited" };
  const r = await self.requestNewLink(String(fd.get("email") ?? ""), ip);
  return { status: r === "ok" ? "sent" : "rate_limited" };
}

export async function respondToMatchAction(...args: [matchId: string, response: "interested" | "not_interested"]) {
  const [matchId, response] = parseArgs(z.tuple([A.id, z.enum(["interested", "not_interested"])]), args);
  const { respondToMatch } = await import("@/server/services/placement");
  const r = fix(await runAction(async () => { await respondToMatch(await ctx(), matchId, response); return null; }));
  revalidatePath(`/me/matches/${matchId}`);
  return r;
}

export async function requestPrivacyCodeAction(...args: [purpose: "export_data" | "delete_account"]): Promise<ActionResult<null>> {
  const [purpose] = parseArgs(z.tuple([z.enum(["export_data", "delete_account"])]), args);
  const p = purpose === "delete_account" ? "delete_account" : "export_data";
  return fix(await runAction(async () => { await self.requestOtp(await ctx(), p); return null; }));
}

export async function exportMyDataAction(...args: [_p: ActionResult<string>, fd: FormData]): Promise<ActionResult<string>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const { exportMyData } = await import("@/server/services/privacy");
  return fix(await runAction(async () => JSON.stringify(await exportMyData(await ctx(), String(fd.get("code") ?? "")), null, 2)));
}

export async function deleteMyAccountAction(...args: [_p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const { deleteMyAccount } = await import("@/server/services/privacy");
  const { cookies } = await import("next/headers");
  const r = fix(await runAction(async () => { await deleteMyAccount(await ctx(), String(fd.get("code") ?? "")); return null; }));
  if (r.ok) {
    (await cookies()).delete("alumni_grad");
    redirect("/me/deleted");
  }
  return r;
}
