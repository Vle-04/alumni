"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CONSENT_PURPOSES } from "@/domain/enums";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { getGraduateContext } from "@/server/graduate-session";
import { UnauthenticatedError } from "@/server/errors";
import * as self from "@/server/services/self-service";
import { clientIp } from "@/server/rate-limit";

async function ctx() {
  const c = await getGraduateContext();
  if (!c) throw new UnauthenticatedError();
  return c;
}
const SESSION_MSG = "Your session expired. Please open the link from your email again.";
const fix = <T,>(r: ActionResult<T>): ActionResult<T> => (!r.ok && r.error === "Please sign in." ? { ...r, error: SESSION_MSG } : r);
const SURVEY_OPTS = { arrays: ["blockers", "helpWanted"] };

export async function submitSurveyAction(surveyId: string, _p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = fix(await runAction(async () => { await self.submitSurvey(await ctx(), surveyId, formToObject(fd, SURVEY_OPTS)); return null; }));
  if (r.ok) redirect("/me/thanks");
  return r;
}

export async function submitSelfUpdateAction(_p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = fix(await runAction(async () => { await self.submitSelfUpdate(await ctx(), formToObject(fd, SURVEY_OPTS)); return null; }));
  if (r.ok) redirect("/me/thanks");
  return r;
}

export async function updatePreferencesAction(_p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = fix(await runAction(async () => { await self.updatePreferences(await ctx(), formToObject(fd, { arrays: ["preferredRoleCategories"], booleans: ["openToRelocate"], json: ["skills"] })); return null; }, "Preferences saved."));
  revalidatePath("/me");
  return r;
}

export async function updateConsentsAction(_p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const granted = Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, fd.get(p) === "on"]));
  const r = fix(await runAction(async () => { await self.updateConsents(await ctx(), granted); return null; }, "Your privacy choices are saved."));
  revalidatePath("/me");
  return r;
}

export async function setSubscriptionAction(subscribed: boolean) {
  await runAction(async () => self.setEmailSubscription(await ctx(), subscribed === true));
  revalidatePath("/me");
}

export async function requestEmailCodeAction(): Promise<ActionResult<null>> {
  return fix(await runAction(async () => { await self.requestOtp(await ctx(), "change_email"); return null; }));
}

export async function changeEmailAction(_p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = fix(await runAction(async () => { await self.changeEmail(await ctx(), formToObject(fd)); return null; }, "Your email is updated."));
  revalidatePath("/me");
  return r;
}

export async function requestNewLinkAction(_p: { status?: string }, fd: FormData): Promise<{ status: "sent" | "rate_limited" }> {
  const r = await self.requestNewLink(String(fd.get("email") ?? ""), await clientIp());
  return { status: r === "ok" ? "sent" : "rate_limited" };
}

export async function respondToMatchAction(matchId: string, response: "interested" | "not_interested") {
  const { respondToMatch } = await import("@/server/services/placement");
  const r = fix(await runAction(async () => { await respondToMatch(await ctx(), matchId, response); return null; }));
  revalidatePath(`/me/matches/${matchId}`);
  return r;
}

export async function requestPrivacyCodeAction(purpose: "export_data" | "delete_account"): Promise<ActionResult<null>> {
  const p = purpose === "delete_account" ? "delete_account" : "export_data";
  return fix(await runAction(async () => { await self.requestOtp(await ctx(), p); return null; }));
}

export async function exportMyDataAction(_p: ActionResult<string>, fd: FormData): Promise<ActionResult<string>> {
  const { exportMyData } = await import("@/server/services/privacy");
  return fix(await runAction(async () => JSON.stringify(await exportMyData(await ctx(), String(fd.get("code") ?? "")), null, 2)));
}

export async function deleteMyAccountAction(_p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const { deleteMyAccount } = await import("@/server/services/privacy");
  const { cookies } = await import("next/headers");
  const r = fix(await runAction(async () => { await deleteMyAccount(await ctx(), String(fd.get("code") ?? "")); return null; }));
  if (r.ok) {
    (await cookies()).delete("alumni_grad");
    redirect("/me/deleted");
  }
  return r;
}
