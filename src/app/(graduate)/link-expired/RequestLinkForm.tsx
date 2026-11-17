"use client";
import { useActionState } from "react";
import { t } from "@/i18n";
import { Alert, Button, Field, Input } from "@/components/ui";
import { requestNewLinkAction } from "../me/actions";

export function RequestLinkForm() {
  const [s, act, pending] = useActionState(requestNewLinkAction, {} as { status?: string });
  if (s.status === "sent") return <Alert tone="success">{t("link.sent")}</Alert>;
  return (
    <form action={act} className="space-y-3">
      {s.status === "rate_limited" && <Alert tone="danger">{t("link.tooMany")}</Alert>}
      <Field id="email" label={t("link.emailLabel")}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Button type="submit" className="w-full" disabled={pending}>{t("link.send")}</Button>
    </form>
  );
}
