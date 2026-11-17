"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { addSynonymAction, mergeSkillAction } from "./actions";

const init = { ok: false, error: "" } as ActionResult<null>;

export function AddSynonym({ skillId, name }: { skillId: string; name: string }) {
  const [s, act, pending] = useActionState(addSynonymAction.bind(null, skillId), init);
  return (
    <form action={act} className="flex items-center gap-1">
      <label className="sr-only" htmlFor={`syn-${skillId}`}>New synonym for {name}</label>
      <Input id={`syn-${skillId}`} name="alias" placeholder="add synonym" className="min-h-8 w-32 py-1 text-xs" />
      <Button type="submit" variant="ghost" className="min-h-8 px-2 py-1 text-xs" disabled={pending}>Add</Button>
      {!s.ok && s.error && <span className="text-xs text-danger" role="alert">{s.error}</span>}
    </form>
  );
}

export function MergeSkills({ skills }: { skills: { id: string; name: string }[] }) {
  const [s, act, pending] = useActionState(mergeSkillAction, init);
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      {s.ok && s.message && <div className="sm:col-span-3"><Alert tone="success">{s.message}</Alert></div>}
      {!s.ok && s.error && <div className="sm:col-span-3"><Alert tone="danger">{s.error}</Alert></div>}
      <Field id="sourceId" label="Merge this skill…"><Select id="sourceId" name="sourceId">{skills.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
      <Field id="targetId" label="…into this one"><Select id="targetId" name="targetId">{skills.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
      <Button type="submit" variant="secondary" disabled={pending} onClick={(e) => { if (!confirm("Merge these skills? This can't be undone.")) e.preventDefault(); }}>Merge</Button>
    </form>
  );
}
