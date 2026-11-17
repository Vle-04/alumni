"use client";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui";
import { rotateLinkAction, sendLinkAction } from "../actions";

export function RotateLink({ id }: { id: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
        const r = await sendLinkAction(id);
        setMsg(r.ok ? { ok: true, text: r.message ?? "Sent" } : { ok: false, text: r.error });
      })}>Email a fresh personal link</Button>
      <Button variant="secondary" disabled={pending} onClick={() => {
        if (!confirm("Revoke every personal link sent to this graduate so far? Their next email will contain a new link.")) return;
        start(async () => {
          const r = await rotateLinkAction(id);
          setMsg(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
        });
      }}>Revoke personal links</Button>
      {msg && <Alert tone={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}
