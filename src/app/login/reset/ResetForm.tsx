"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field id="password" label="New password" help="At least 12 characters." error={fe.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Field id="confirm" label="Confirm new password" error={fe.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Saving…" : "Set password"}</Button>
    </form>
  );
}
