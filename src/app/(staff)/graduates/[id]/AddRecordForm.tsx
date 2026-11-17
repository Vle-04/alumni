"use client";
import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { ActionResult } from "@/lib/action";

type Opt = { value: string; label: string };
const EMPLOYED = ["employed_full_time", "employed_part_time", "freelance_contract", "internship"];

export function AddRecordForm({ action, statuses, roles, salaryBands, types }: {
  action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  statuses: Opt[]; roles: Opt[]; salaryBands: Opt[]; types: Opt[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<unknown>);
  const [status, setStatus] = useState("employed_full_time");
  const employed = EMPLOYED.includes(status);
  const fe = !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2" noValidate>
      {!state.ok && state.error && <div className="sm:col-span-2"><Alert tone="danger">{state.error}</Alert></div>}
      {state.ok && state.message && <div className="sm:col-span-2"><Alert tone="success">{state.message}</Alert></div>}
      <Field id="status" label="Status" error={fe.status}>
        <Select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
      </Field>
      {employed && <>
        <Field id="companyName" label="Company" error={fe.companyName} help="Matched to existing companies; similar names are suggested for merging.">
          <Input id="companyName" name="companyName" aria-invalid={Boolean(fe.companyName)} />
        </Field>
        <Field id="roleTitle" label="Role title"><Input id="roleTitle" name="roleTitle" /></Field>
        <Field id="roleCategory" label="Role category">
          <Select id="roleCategory" name="roleCategory" defaultValue=""><option value="">—</option>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
        </Field>
        <Field id="inField" label="In field?">
          <Select id="inField" name="inField" defaultValue=""><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></Select>
        </Field>
        <Field id="employmentType" label="Employment type">
          <Select id="employmentType" name="employmentType" defaultValue=""><option value="">—</option>{types.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
        </Field>
        <Field id="startDate" label="Start date" error={fe.startDate}><Input id="startDate" name="startDate" type="date" /></Field>
        <Field id="endDate" label="End date (if it ended)" error={fe.endDate}><Input id="endDate" name="endDate" type="date" /></Field>
        <Field id="salaryBand" label="Monthly salary band (optional)" help="Bands only — never an exact salary.">
          <Select id="salaryBand" name="salaryBand" defaultValue=""><option value="">Not provided</option>{salaryBands.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
        </Field>
      </>}
      <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add record"}</Button></div>
    </form>
  );
}
