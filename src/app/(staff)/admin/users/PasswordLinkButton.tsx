"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/action";

export function PasswordLinkButton({ action, name }: { action: () => Promise<ActionResult<void>>; name: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" disabled={pending} aria-label={`Email ${name} a link to set their password`}
        onClick={() => start(async () => { const r = await action(); setMsg(r.ok ? r.message ?? "Sent." : r.error); })}>
        {pending ? "Sending…" : "Send password link"}
      </Button>
      <span role="status" className="text-sm text-muted">{msg}</span>
    </span>
  );
}
