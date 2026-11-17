"use client";
import { useActionState, useState } from "react";
import { REMOTE_MODES, ROLE_CATEGORIES, SALARY_BANDS } from "@/domain/enums";
import { enumLabel } from "@/i18n";
import type { ActionResult } from "@/lib/action";
import { isoDay } from "@/lib/format";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";

export interface OpeningFormValues {
  companyId?: string; title?: string; description?: string; roleCategory?: string | null; city?: string | null; country?: string | null;
  remoteMode?: string; seniority?: string; salaryBand?: string | null; deadline?: Date | null; skills?: { name: string; weight: number; mustHave: boolean }[];
}

/** Used by staff (with company picker) and by partners (company fixed, so no picker). */
export function OpeningForm({ action, initial = {}, companies, submitLabel }: {
  action: (p: ActionResult<string>, fd: FormData) => Promise<ActionResult<string>>;
  initial?: OpeningFormValues; companies?: { id: string; name: string }[]; submitLabel: string;
}) {
  const [s, act, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<string>);
  const [skills, setSkills] = useState(initial.skills?.length ? initial.skills : [{ name: "", weight: 3, mustHave: true }]);
  const fe = !s.ok ? s.fieldErrors ?? {} : {};
  const set = (i: number, p: Partial<(typeof skills)[number]>) => setSkills(skills.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <form action={act} className="space-y-5" noValidate>
      {!s.ok && s.error && <Alert tone="danger">{s.error}</Alert>}
      {s.ok && s.message && <Alert tone="success">{s.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {companies && (
          <Field id="companyId" label="Company" error={fe.companyId}>
            <Select id="companyId" name="companyId" defaultValue={initial.companyId ?? ""}><option value="">Choose…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
        )}
        <Field id="title" label="Job title" error={fe.title}><Input id="title" name="title" defaultValue={initial.title} /></Field>
        <Field id="roleCategory" label="Role category">
          <Select id="roleCategory" name="roleCategory" defaultValue={initial.roleCategory ?? ""}><option value="">—</option>{ROLE_CATEGORIES.map((r) => <option key={r} value={r}>{enumLabel("role", r)}</option>)}</Select>
        </Field>
        <Field id="seniority" label="Seniority">
          <Select id="seniority" name="seniority" defaultValue={initial.seniority ?? "junior"}>{["intern", "junior", "mid", "senior"].map((v) => <option key={v} value={v}>{v[0]!.toUpperCase() + v.slice(1)}</option>)}</Select>
        </Field>
        <Field id="remoteMode" label="Work mode">
          <Select id="remoteMode" name="remoteMode" defaultValue={initial.remoteMode ?? "onsite"}>{REMOTE_MODES.map((v) => <option key={v} value={v}>{enumLabel("remoteMode", v)}</option>)}</Select>
        </Field>
        <Field id="city" label="City"><Input id="city" name="city" defaultValue={initial.city ?? ""} /></Field>
        <Field id="country" label="Country"><Input id="country" name="country" defaultValue={initial.country ?? ""} /></Field>
        <Field id="salaryBand" label="Monthly salary band (optional)">
          <Select id="salaryBand" name="salaryBand" defaultValue={initial.salaryBand ?? ""}><option value="">Not stated</option>{SALARY_BANDS.filter((b) => b !== "prefer_not_to_say").map((b) => <option key={b} value={b}>{enumLabel("salary", b)}</option>)}</Select>
        </Field>
        <Field id="deadline" label="Application deadline"><Input id="deadline" name="deadline" type="date" defaultValue={isoDay(initial.deadline)} /></Field>
      </div>
      <Field id="description" label="Description" error={fe.description}><Textarea id="description" name="description" rows={5} defaultValue={initial.description} /></Field>

      <fieldset>
        <legend className="text-base font-semibold">Required skills</legend>
        <p className="mb-2 text-xs text-muted">Importance 1–5 weights the match score. Candidates missing a <strong>must-have</strong> skill are not matched at all.</p>
        <input type="hidden" name="skills" value={JSON.stringify(skills.filter((x) => x.name.trim()))} />
        {fe.skills && <p className="text-xs text-danger" role="alert">{fe.skills.join(" ")}</p>}
        <ul className="space-y-2">
          {skills.map((sk, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1"><label htmlFor={`os-${i}`} className="text-xs text-muted">Skill {i + 1}</label><Input id={`os-${i}`} value={sk.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. React" /></div>
              <div className="w-28"><label htmlFor={`ow-${i}`} className="text-xs text-muted">Importance</label>
                <Select id={`ow-${i}`} value={sk.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{w}</option>)}</Select></div>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={sk.mustHave} onChange={(e) => set(i, { mustHave: e.target.checked })} className="size-4" />Must-have</label>
              <Button type="button" variant="ghost" onClick={() => setSkills(skills.filter((_, j) => j !== i))} aria-label={`Remove skill ${sk.name || i + 1}`}>Remove</Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" className="mt-2" onClick={() => setSkills([...skills, { name: "", weight: 3, mustHave: false }])}>Add skill</Button>
      </fieldset>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
