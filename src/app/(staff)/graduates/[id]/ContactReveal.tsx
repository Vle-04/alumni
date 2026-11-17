"use client";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui";
import { revealContactAction } from "../actions";

export function ContactReveal({ id, has, hiddenNote }: { id: string; has: { email: boolean; phone: boolean; linkedin: boolean }; hiddenNote: string }) {
  const [data, setData] = useState<{ email: string | null; phone: string | null; linkedinUrl: string | null } | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (data) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <dt className="text-muted">Email</dt><dd className="break-all">{data.email ?? "—"}</dd>
        <dt className="text-muted">Phone</dt><dd>{data.phone ?? "—"}</dd>
        <dt className="text-muted">LinkedIn</dt>
        {/* Rendered as plain text, not a link: the app never navigates to or fetches third-party profiles. */}
        <dd className="break-all">{data.linkedinUrl ?? "—"}</dd>
      </dl>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{hiddenNote}</p>
      <p className="text-sm">On file: {[has.email && "email", has.phone && "phone", has.linkedin && "LinkedIn URL"].filter(Boolean).join(", ") || "nothing"}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
        const r = await revealContactAction(id);
        if (r.ok) setData(r.data); else setError(r.error);
      })}>{pending ? "Loading…" : "Show contact details"}</Button>
    </div>
  );
}
