"use client";
import { useActionState } from "react";
import { BLOCKER_OPTIONS, HELP_OPTIONS, SURVEY_STATUS_OPTIONS, type ConfirmPrompt, type LastKnown } from "@/domain/surveys/form";
import { SALARY_BANDS } from "@/domain/enums";
import { enumLabel, t } from "@/i18n";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Input, Select } from "@/components/ui";

const EMPLOYED = ["employed_full_time", "employed_part_time", "freelance_contract", "internship"];

/**
 * The check-in / self-update form. Two separate <form>s so pressing Enter in a text field can
 * never trigger "Yes, nothing changed" by accident.
 */
export function SurveyForm({ action, prompt, last }: { action: (p: ActionResult<null>, fd: FormData) => Promise<ActionResult<null>>; prompt: ConfirmPrompt; last: LastKnown | null }) {
  const [state, formAction, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<null>);
  const fe = !state.ok ? state.fieldErrors ?? {} : {};
  const lastEmployed = last && EMPLOYED.includes(last.status);
  const err = (k: string) => (fe[k] ? <p id={`${k}-error`} className="mt-1 text-sm text-danger" role="alert">{fe[k]!.join(" ")}</p> : null);

  const promptText = !prompt ? null
    : prompt.kind === "employed"
      ? prompt.roleTitle ? t("grad.stillAt", { company: prompt.companyName, role: prompt.roleTitle }) : t("grad.stillAtNoRole", { company: prompt.companyName })
      : t("grad.stillStatus", { status: enumLabel("status", prompt.status).toLowerCase() });

  return (
    <div className="space-y-6">
      {!state.ok && state.error && <Alert tone="danger">{state.error}</Alert>}
      {promptText && (
        <form action={formAction} className="rounded-lg border-2 border-accent bg-surface p-4">
          <input type="hidden" name="mode" value="unchanged" />
          <p className="text-lg font-semibold">{promptText}</p>
          <Button type="submit" className="mt-3 w-full py-3 text-base" disabled={pending}>{t("grad.yesNothingChanged")}</Button>
        </form>
      )}

      <form action={formAction} className="survey space-y-5" noValidate>
        <input type="hidden" name="mode" value="update" />
        {promptText && <p className="font-medium">{t("grad.orUpdate")}</p>}
        <fieldset aria-describedby={fe.status ? "status-error" : undefined}>
          <legend className="mb-2 font-semibold">{t("grad.whatNow")}</legend>
          <div className="grid gap-2">
            {SURVEY_STATUS_OPTIONS.map((s) => (
              <label key={s} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10">
                <input type="radio" name="status" value={s} defaultChecked={last?.status === s} className="size-5" />
                <span>{enumLabel("status", s)}</span>
              </label>
            ))}
          </div>
          {err("status")}
        </fieldset>

        <div className="branch branch-employed space-y-4">
          <div><label htmlFor="companyName" className="block font-medium">{t("grad.company")}</label>
            <Input id="companyName" name="companyName" autoComplete="organization" defaultValue={lastEmployed ? last?.companyName ?? "" : ""} aria-invalid={Boolean(fe.companyName)} aria-describedby={fe.companyName ? "companyName-error" : undefined} />{err("companyName")}</div>
          <div><label htmlFor="roleTitle" className="block font-medium">{t("grad.role")}</label>
            <Input id="roleTitle" name="roleTitle" autoComplete="organization-title" defaultValue={lastEmployed ? last?.roleTitle ?? "" : ""} /></div>
          <div><label htmlFor="startMonth" className="block font-medium">{t("grad.startMonth")}</label>
            <Input id="startMonth" name="startMonth" type="month" placeholder="2026-03" defaultValue={lastEmployed && last?.startDate ? new Date(last.startDate).toISOString().slice(0, 7) : ""} aria-invalid={Boolean(fe.startMonth)} />{err("startMonth")}</div>
          <fieldset><legend className="font-medium">{t("grad.inField")}</legend>
            <div className="mt-1 flex gap-4">
              {(["yes", "no"] as const).map((v) => <label key={v} className="flex min-h-11 items-center gap-2"><input type="radio" name="inField" value={v} defaultChecked={lastEmployed ? (last?.inField === (v === "yes")) : false} className="size-5" />{t(`grad.${v}`)}</label>)}
            </div></fieldset>
          <div><label htmlFor="salaryBand" className="block font-medium">{t("grad.salaryBand")}</label>
            <Select id="salaryBand" name="salaryBand" defaultValue="" aria-describedby="salary-help"><option value="">—</option>{SALARY_BANDS.map((b) => <option key={b} value={b}>{enumLabel("salary", b)}</option>)}</Select>
            <p id="salary-help" className="mt-1 text-xs text-muted">{t("grad.salaryHelp")}</p></div>
          <fieldset><legend className="font-medium">{t("grad.openToOffers")}</legend>
            <div className="mt-1 flex gap-4">
              {(["yes", "no"] as const).map((v) => <label key={v} className="flex min-h-11 items-center gap-2"><input type="radio" name="openToOffers" value={v} className="size-5" />{t(`grad.${v}`)}</label>)}
            </div></fieldset>
        </div>

        <div className="branch branch-searching space-y-4">
          <fieldset><legend className="font-medium">{t("grad.blockers")}</legend>
            <div className="mt-1 grid gap-1">{BLOCKER_OPTIONS.map((b) => <label key={b} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="blockers" value={b} className="size-5" />{t(`grad.blocker.${b}`)}</label>)}</div></fieldset>
          <fieldset><legend className="font-medium">{t("grad.helpWanted")}</legend>
            <div className="mt-1 grid gap-1">{HELP_OPTIONS.map((h) => <label key={h} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="helpWanted" value={h} className="size-5" />{t(`grad.help.${h}`)}</label>)}</div></fieldset>
        </div>

        <Button type="submit" className="w-full py-3 text-base" disabled={pending}>{pending ? t("grad.saving") : t("grad.submit")}</Button>
      </form>
    </div>
  );
}
