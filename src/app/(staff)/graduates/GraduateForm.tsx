"use client";
import { useActionState } from "react";
import { SkillsEditor } from "@/components/SkillsEditor";
import { Alert, Button, Field, Input, Select, describedBy } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { isoDay } from "@/lib/format";

export interface GraduateFormValues {
  fullName: string; preferredName: string; email: string; phone: string; linkedinUrl: string; cohortId: string;
  graduationDateOverride: Date | null; timezone: string; city: string; country: string; remotePreference: string;
  openToRelocate: boolean; jobSearchStatus: string; preferredRoleCategories: string[]; skills: { name: string; level: number }[];
}

type Opt = { value: string; label: string };

export function GraduateForm({ action, initial, cohorts, roles, remotes, jobSearch, submitLabel }: {
  action: (p: ActionResult<string>, fd: FormData) => Promise<ActionResult<string>>;
  initial?: Partial<GraduateFormValues>; cohorts: Opt[]; roles: Opt[]; remotes: Opt[]; jobSearch: Opt[]; submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<string>);
  const fe = !state.ok ? state.fieldErrors ?? {} : {};
  const v = initial ?? {};
  const field = (id: keyof GraduateFormValues, label: string, props: React.ComponentProps<typeof Input> = {}, help?: string) => (
    <Field id={id} label={label} error={fe[id]} help={help}>
      <Input id={id} name={id} defaultValue={(v[id] as string | undefined) ?? ""} aria-invalid={Boolean(fe[id])} aria-describedby={describedBy(id, { help: Boolean(help), error: fe[id] })} {...props} />
    </Field>
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {!state.ok && state.error && <Alert tone="danger">{state.error}</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Identity & contact</legend>
        {field("fullName", "Full name", { required: true, autoComplete: "off" })}
        {field("preferredName", "Preferred name (optional)")}
        {field("email", "Preferred email", { type: "email", required: true })}
        {field("phone", "Phone (optional)", { type: "tel" })}
        {field("linkedinUrl", "LinkedIn URL (optional)", { type: "url" }, "Stored as text only. The system never visits or reads this profile.")}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Program</legend>
        <Field id="cohortId" label="Cohort" error={fe.cohortId}>
          <Select id="cohortId" name="cohortId" defaultValue={v.cohortId ?? ""} required aria-invalid={Boolean(fe.cohortId)}>
            <option value="">Choose…</option>{cohorts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        {field("graduationDateOverride", "Graduation date override (optional)", { type: "date", defaultValue: isoDay(v.graduationDateOverride) }, "Only if this graduate finished on a different date than the cohort.")}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Job search preferences</legend>
        <Field id="jobSearchStatus" label="Job search">
          <Select id="jobSearchStatus" name="jobSearchStatus" defaultValue={v.jobSearchStatus ?? "active"}>{jobSearch.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
        <Field id="remotePreference" label="Work location preference">
          <Select id="remotePreference" name="remotePreference" defaultValue={v.remotePreference ?? "any"}>{remotes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
        {field("city", "City")}
        {field("country", "Country")}
        {field("timezone", "Time zone (optional)", { placeholder: "Asia/Yerevan" }, "Used for quiet hours when sending surveys.")}
        <div className="flex items-center gap-2 pt-6">
          <input id="openToRelocate" name="openToRelocate" type="checkbox" defaultChecked={v.openToRelocate} className="size-5" />
          <label htmlFor="openToRelocate" className="text-sm">Open to relocating</label>
        </div>
        <div className="sm:col-span-2">
          <p id="roles-label" className="text-sm font-medium">Preferred roles (up to 5)</p>
          {fe.preferredRoleCategories && <p className="text-xs text-danger" role="alert">{fe.preferredRoleCategories.join(" ")}</p>}
          <div role="group" aria-labelledby="roles-label" className="mt-2 grid gap-2 sm:grid-cols-3">
            {roles.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="preferredRoleCategories" value={r.value} defaultChecked={v.preferredRoleCategories?.includes(r.value)} className="size-4" />{r.label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <SkillsEditor initial={initial?.skills} error={fe.skills} />

      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
