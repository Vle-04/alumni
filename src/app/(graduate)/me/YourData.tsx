"use client";
import { useActionState, useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Field, Input } from "@/components/ui";
import { deleteMyAccountAction, exportMyDataAction, requestPrivacyCodeAction } from "./actions";

function CodeStep({ purpose, label, children }: { purpose: "export_data" | "delete_account"; label: string; children: (sent: boolean) => React.ReactNode }) {
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {!sent ? (
        <Button variant={purpose === "delete_account" ? "danger" : "secondary"} disabled={pending} onClick={() => start(async () => {
          const r = await requestPrivacyCodeAction(purpose);
          if (r.ok) setSent(true); else setErr(r.error);
        })}>{label}</Button>
      ) : <Alert tone="success">{t("grad.codeSent")}</Alert>}
      {err && <Alert tone="danger">{err}</Alert>}
      {children(sent)}
    </div>
  );
}

export function DownloadData() {
  const [s, act, pending] = useActionState(exportMyDataAction, { ok: false, error: "" } as ActionResult<string>);
  if (s.ok) {
    const href = `data:application/json;charset=utf-8,${encodeURIComponent(s.data)}`;
    return <a href={href} download="my-academy-data.json" className="inline-flex min-h-10 items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg">Save my-academy-data.json</a>;
  }
  return (
    <CodeStep purpose="export_data" label={t("grad.downloadData")}>
      {(sent) => sent && (
        <form action={act} className="space-y-2">
          {!s.ok && s.error && <Alert tone="danger">{s.error}</Alert>}
          <Field id="export-code" label={t("grad.codeLabel")}><Input id="export-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Field>
          <Button type="submit" disabled={pending}>{t("grad.downloadData")}</Button>
        </form>
      )}
    </CodeStep>
  );
}

export function DeleteAccount() {
  const [s, act, pending] = useActionState(deleteMyAccountAction, { ok: false, error: "" } as ActionResult<null>);
  return (
    <CodeStep purpose="delete_account" label={t("grad.deleteAccount")}>
      {(sent) => sent && (
        <form action={act} className="space-y-2 rounded-md border border-danger/50 p-3">
          <p className="text-sm">{t("grad.deleteWarning")}</p>
          {!s.ok && s.error && <Alert tone="danger">{s.error}</Alert>}
          <Field id="delete-code" label={t("grad.codeLabel")}><Input id="delete-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Field>
          <Button type="submit" variant="danger" disabled={pending}>{t("grad.deleteConfirm")}</Button>
        </form>
      )}
    </CodeStep>
  );
}
