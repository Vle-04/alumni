"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { ActionResult } from "@/lib/action";

export function InviteForm({ action }: { action: (p: ActionResult<string>, fd: FormData) => Promise<ActionResult<string>> }) {
  const [s, act, pending] = useActionState(action, { ok: false, error: "" } as ActionResult<string>);
  const fe = !s.ok ? s.fieldErrors ?? {} : {};
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-4" noValidate>
      {!s.ok && s.error && <div className="sm:col-span-4"><Alert tone="danger">{s.error}</Alert></div>}
      {s.ok && s.message && <div className="sm:col-span-4"><Alert tone="success">{s.message}</Alert></div>}
      <Field id="inv-name" label="Name" error={fe.name}><Input id="inv-name" name="name" /></Field>
      <Field id="inv-email" label="Work email" error={fe.email}><Input id="inv-email" name="email" type="email" /></Field>
      <Field id="inv-role" label="Role">
        <Select id="inv-role" name="role" defaultValue="CAREER_SERVICES">
          <option value="CAREER_SERVICES">Career Services</option><option value="LEADERSHIP">Leadership / Marketing (aggregates only)</option><option value="ADMIN">Admin</option>
        </Select>
      </Field>
      <div className="flex items-end"><Button type="submit" disabled={pending}>Invite</Button></div>
    </form>
  );
}
