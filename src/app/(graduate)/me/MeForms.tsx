"use client";
import { useActionState, useState, useTransition } from "react";
import { CONSENT_PURPOSES, JOB_SEARCH_STATUSES, REMOTE_PREFERENCES, ROLE_CATEGORIES } from "@/domain/enums";
import { enumLabel, t } from "@/i18n";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { SkillsEditor } from "@/components/SkillsEditor";
import { changeEmailAction, requestEmailCodeAction, updateConsentsAction, updatePreferencesAction } from "./actions";

const init = { ok: false, error: "" } as ActionResult<null>;
function Result({ s }: { s: ActionResult<null> }) {
  if (s.ok && s.message) return <Alert tone="success">{s.message}</Alert>;
  if (!s.ok && s.error) return <Alert tone="danger">{s.error}</Alert>;
  return null;
}

export interface Prefs {
  jobSearchStatus: string; remotePreference: string; openToRelocate: boolean; city: string; country: string;
  preferredRoleCategories: string[]; skills: { name: string; level: number }[];
}

export function PreferencesForm({ prefs }: { prefs: Prefs }) {
  const [s, act, pending] = useActionState(updatePreferencesAction, init);
  const fe = !s.ok ? s.fieldErrors ?? {} : {};
  return (
    <form action={act} className="space-y-4">
      <Result s={s} />
      <Field id="jobSearchStatus" label="Job search">
        <Select id="jobSearchStatus" name="jobSearchStatus" defaultValue={prefs.jobSearchStatus}>{JOB_SEARCH_STATUSES.map((v) => <option key={v} value={v}>{enumLabel("jobSearch", v)}</option>)}</Select>
      </Field>
      <Field id="remotePreference" label="Where can you work?">
        <Select id="remotePreference" name="remotePreference" defaultValue={prefs.remotePreference}>{REMOTE_PREFERENCES.map((v) => <option key={v} value={v}>{enumLabel("remote", v)}</option>)}</Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="city" label="City"><Input id="city" name="city" defaultValue={prefs.city} autoComplete="address-level2" /></Field>
        <Field id="country" label="Country"><Input id="country" name="country" defaultValue={prefs.country} autoComplete="country-name" /></Field>
      </div>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="openToRelocate" defaultChecked={prefs.openToRelocate} className="size-5" /> Open to relocating</label>
      <fieldset>
        <legend className="font-medium">Roles you&rsquo;re interested in (up to 5)</legend>
        {fe.preferredRoleCategories && <p className="text-sm text-danger" role="alert">Choose at most 5.</p>}
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {ROLE_CATEGORIES.map((r) => <label key={r} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="preferredRoleCategories" value={r} defaultChecked={prefs.preferredRoleCategories.includes(r)} className="size-5" />{enumLabel("role", r)}</label>)}
        </div>
      </fieldset>
      <SkillsEditor initial={prefs.skills} error={fe.skills} legend="Your skills (rate yourself 1–5)" />
      <Button type="submit" disabled={pending} className="w-full">{pending ? t("grad.saving") : "Save preferences"}</Button>
    </form>
  );
}

export function ConsentForm({ granted }: { granted: string[] }) {
  const [s, act, pending] = useActionState(updateConsentsAction, init);
  return (
    <form action={act} className="space-y-3">
      <Result s={s} />
      <p className="text-sm text-muted">{t("grad.consentHelp")}</p>
      {CONSENT_PURPOSES.map((p) => (
        <label key={p} className="flex items-start gap-3 rounded-md border border-border p-3">
          <input type="checkbox" name={p} defaultChecked={granted.includes(p)} className="mt-0.5 size-5 shrink-0" />
          <span>{enumLabel("consent", p)}</span>
        </label>
      ))}
      <Button type="submit" disabled={pending} className="w-full">{pending ? t("grad.saving") : "Save privacy choices"}</Button>
    </form>
  );
}

export function ChangeEmail() {
  const [step, setStep] = useState<"start" | "code">("start");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string }>();
  const [pending, start] = useTransition();
  const [s, act, changing] = useActionState(changeEmailAction, init);
  if (s.ok) return <Alert tone="success">{t("grad.emailChanged")}</Alert>;
  const fe = !s.ok ? s.fieldErrors ?? {} : {};
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {step === "start" ? (
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
          const r = await requestEmailCodeAction();
          if (r.ok) { setStep("code"); setMsg({ tone: "success", text: t("grad.codeSent") }); } else setMsg({ tone: "danger", text: r.error });
        })}>{t("grad.changeEmail")}: {t("grad.sendCode").toLowerCase()}</Button>
      ) : (
        <form action={act} className="space-y-3">
          {!s.ok && s.error && <Alert tone="danger">{s.error}</Alert>}
          <Field id="code" label={t("grad.codeLabel")} error={fe.code}><Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} /></Field>
          <Field id="newEmail" label={t("grad.newEmail")} error={fe.newEmail}><Input id="newEmail" name="newEmail" type="email" autoComplete="email" /></Field>
          <Button type="submit" disabled={changing} className="w-full">{t("grad.confirmChange")}</Button>
        </form>
      )}
    </div>
  );
}
