"use client";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Field, Input } from "@/components/ui";
import { addContactAction, issueLinkAction, updateCompanyAction } from "./actions";

export function CompanyForm({ c }: { c: { id: string; canonicalName: string; industry: string | null; website: string | null; isPartner: boolean } }) {
  const [s, act, pending] = useActionState(updateCompanyAction.bind(null, c.id), { ok: false, error: "" } as ActionResult<null>);
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-2">
      {s.ok && <div className="sm:col-span-2"><Alert tone="success">{s.message}</Alert></div>}
      {!s.ok && s.error && <div className="sm:col-span-2"><Alert tone="danger">{s.error}</Alert></div>}
      <Field id="canonicalName" label="Name"><Input id="canonicalName" name="canonicalName" defaultValue={c.canonicalName} /></Field>
      <Field id="industry" label="Industry"><Input id="industry" name="industry" defaultValue={c.industry ?? ""} /></Field>
      <Field id="website" label="Website"><Input id="website" name="website" type="url" defaultValue={c.website ?? ""} /></Field>
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="isPartner" defaultChecked={c.isPartner} className="size-4" /> Partner company</label>
      <div><Button type="submit" disabled={pending}>Save</Button></div>
    </form>
  );
}

export function AddContact({ companyId }: { companyId: string }) {
  const [s, act, pending] = useActionState(addContactAction.bind(null, companyId), { ok: false, error: "" } as ActionResult<string>);
  const fe = !s.ok ? s.fieldErrors ?? {} : {};
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      {!s.ok && s.error && <div className="sm:col-span-3"><Alert tone="danger">{s.error}</Alert></div>}
      <Field id="pc-name" label="Name" error={fe.name}><Input id="pc-name" name="name" /></Field>
      <Field id="pc-email" label="Email" error={fe.email}><Input id="pc-email" name="email" type="email" /></Field>
      <Button type="submit" variant="secondary" disabled={pending}>Add contact</Button>
    </form>
  );
}

export function PortalLink({ contactId }: { contactId: string }) {
  const [link, setLink] = useState<string>();
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const issue = (rotate: boolean) => start(async () => { const r = await issueLinkAction(contactId, rotate); if (r.ok) setLink(r.data); else setErr(r.error); });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => issue(false)}>Get portal link</Button>
        <Button variant="ghost" disabled={pending} onClick={() => confirm("Revoke all earlier links for this contact?") && issue(true)}>Revoke & reissue</Button>
      </div>
      {link && (
        <div className="space-y-1">
          <label className="text-xs text-muted" htmlFor={`pl-${contactId}`}>Send this link to the contact (valid 90 days):</label>
          <Input id={`pl-${contactId}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
        </div>
      )}
      {err && <Alert tone="danger">{err}</Alert>}
    </div>
  );
}
