"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { requestPasswordResetAction } from "../actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, {});
  if (state.sent) {
    return <Alert tone="success">If that address belongs to a staff account, a link to reset the password is on its way. It expires in 1 hour.</Alert>;
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field id="email" label="Email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Sending…" : "Email me a reset link"}</Button>
    </form>
  );
}
