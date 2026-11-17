"use client";
import { useActionState } from "react";
import { Button, Field, Input, Alert } from "@/components/ui";
import { requestStaffLink } from "./actions";

export function LoginForm({ labels }: { labels: { email: string; send: string } }) {
  const [state, action, pending] = useActionState(requestStaffLink, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field id="email" label={labels.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.error)} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Sending…" : labels.send}</Button>
    </form>
  );
}
