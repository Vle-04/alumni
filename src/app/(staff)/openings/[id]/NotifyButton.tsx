"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { notifyAction } from "../actions";

export function NotifyButton({ openingId, graduateId, name }: { openingId: string; graduateId: string; name: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  if (msg?.ok) return <span className="text-sm text-success" role="status">Notified</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant="secondary" disabled={pending} aria-label={`Notify ${name} about this opening`}
        onClick={() => start(async () => { const r = await notifyAction(openingId, graduateId); setMsg(r.ok ? { ok: true, text: "" } : { ok: false, text: r.error }); })}>
        {pending ? "Sending…" : "Notify"}
      </Button>
      {msg && !msg.ok && <span className="text-xs text-danger" role="alert">{msg.text}</span>}
    </span>
  );
}
