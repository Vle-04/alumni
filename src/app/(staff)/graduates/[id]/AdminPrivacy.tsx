"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Field, Input } from "@/components/ui";
import { deleteGraduateAction } from "../actions";

export function AdminPrivacy({ id }: { id: string }) {
  const [s, act, pending] = useActionState(deleteGraduateAction.bind(null, id), { ok: false, error: "" } as ActionResult<null>);
  return (
    <div className="space-y-4">
      <a href={`/api/graduates/${id}/export`} download className="inline-flex min-h-10 items-center rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-surface-2">Export data (JSON)</a>
      <form action={act} className="space-y-2 rounded-md border border-danger/50 p-3">
        <p className="text-sm">Delete on the graduate&rsquo;s request: personal data is removed; anonymous history is kept so reports don&rsquo;t change. Cannot be undone.</p>
        {!s.ok && s.error && <Alert tone="danger">{s.error}</Alert>}
        <Field id="confirm" label="Type DELETE to confirm" error={!s.ok ? s.fieldErrors?.form : undefined}><Input id="confirm" name="confirm" autoComplete="off" /></Field>
        <Button type="submit" variant="danger" disabled={pending}>Delete personal data</Button>
      </form>
    </div>
  );
}
