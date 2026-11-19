"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input, Alert } from "@/components/ui";
import { signInWithPasswordAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInWithPasswordAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field id="email" label="Email" error={fe.email}>
        <Input id="email" name="email" type="email" autoComplete="username" required aria-invalid={Boolean(fe.email || state.error)} />
      </Field>
      <Field id="password" label="Password" error={fe.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(fe.password || state.error)} />
      </Field>
      <div className="flex justify-end text-sm">
        <Link href="/login/forgot" className="underline underline-offset-2">Forgot password?</Link>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
