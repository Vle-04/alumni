"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { isoDay } from "@/lib/format";

export function CohortForm({ action, programs, initial, submitLabel }: {
  action: (p: ActionResult<string>, fd: FormData) => Promise<ActionResult<string>>;
  programs: { id: string; name: string }[];
  initial?: { programId: string; name: string; startDate: Date; graduationDate: Date | null; plannedSize: number | null };
  submitLabel: string;
}) {
  const [s, act, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<string>);
  const fe = !s.ok ? s.fieldErrors ?? {} : {};
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-2" noValidate>
      {!s.ok && s.error && <div className="sm:col-span-2"><Alert tone="danger">{s.error}</Alert></div>}
      {s.ok && s.message && <div className="sm:col-span-2"><Alert tone="success">{s.message}</Alert></div>}
      <Field id="programId" label="Program" error={fe.programId}>
        <Select id="programId" name="programId" defaultValue={initial?.programId ?? ""}><option value="">Choose…</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      </Field>
      <Field id="name" label="Cohort name" error={fe.name}><Input id="name" name="name" defaultValue={initial?.name} /></Field>
      <Field id="startDate" label="Start date" error={fe.startDate}><Input id="startDate" name="startDate" type="date" defaultValue={isoDay(initial?.startDate)} /></Field>
      <Field id="graduationDate" label="Graduation date" error={fe.graduationDate} help="Setting or changing this schedules check-in surveys at 1, 3, 6 and 12 months.">
        <Input id="graduationDate" name="graduationDate" type="date" defaultValue={isoDay(initial?.graduationDate)} />
      </Field>
      <Field id="plannedSize" label="Planned size" error={fe.plannedSize}><Input id="plannedSize" name="plannedSize" type="number" min={1} defaultValue={initial?.plannedSize ?? ""} /></Field>
      <div className="flex items-end"><Button type="submit" disabled={pending}>{submitLabel}</Button></div>
    </form>
  );
}

export function ProgramForm({ action }: { action: (p: ActionResult<string>, fd: FormData) => Promise<ActionResult<string>> }) {
  const [s, act, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<string>);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <Field id="program-name" label="New program name" error={!s.ok && s.error ? s.error : undefined}><Input id="program-name" name="name" /></Field>
      <Button type="submit" variant="secondary" disabled={pending}>Add program</Button>
    </form>
  );
}
