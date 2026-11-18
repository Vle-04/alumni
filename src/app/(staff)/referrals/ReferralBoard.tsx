"use client";
import Link from "next/link";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import * as Dialog from "@radix-ui/react-dialog";
import { enumLabel } from "@/i18n";
import type { ActionResult } from "@/lib/action";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui";
import { confirmHireAction, moveReferralAction } from "./actions";

export interface BoardCard {
  id: string; status: string; allowed: string[]; daysInStage: number;
  graduate: { id: string; fullName: string }; opening: { id: string; title: string; company: string };
}

const COLUMNS = ["suggested", "graduate_interested", "referred", "interviewing", "offer", "hired", "rejected", "withdrawn"];

function Card({ c, onMove, pending }: { c: BoardCard; onMove: (c: BoardCard, to: string) => void; pending: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: c.id, data: c, disabled: c.allowed.length === 0 });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : undefined;
  return (
    <li ref={setNodeRef} style={style} className={`rounded-md border border-border bg-surface p-2 text-sm shadow-sm ${isDragging ? "opacity-80 ring-2 ring-accent" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <Link href={`/graduates/${c.graduate.id}`} className="font-medium text-accent underline">{c.graduate.fullName}</Link>
        {c.allowed.length > 0 && (
          <button type="button" {...listeners} {...attributes} aria-label={`Drag ${c.graduate.fullName}'s referral to another stage`} aria-roledescription="draggable referral" className="cursor-grab rounded px-1 text-muted hover:bg-surface-2">⠿</button>
        )}
      </div>
      <p className="text-xs">{c.opening.title} · {c.opening.company}</p>
      <p className={`mt-1 text-xs ${c.daysInStage > 14 && !["hired", "rejected", "withdrawn"].includes(c.status) ? "font-semibold text-warning" : "text-muted"}`}>{c.daysInStage} days in stage</p>
      {c.allowed.length > 0 && (
        <label className="mt-1 block text-xs">
          <span className="sr-only">Move {c.graduate.fullName} to</span>
          <Select className="min-h-8 py-1 text-xs" value="" disabled={pending} onChange={(e) => e.target.value && onMove(c, e.target.value)}>
            <option value="">Move to…</option>
            {c.allowed.map((s) => <option key={s} value={s}>{enumLabel("referral", s)}</option>)}
          </Select>
        </label>
      )}
    </li>
  );
}

function Column({ status, cards, onMove, pending }: { status: string; cards: BoardCard[]; onMove: (c: BoardCard, to: string) => void; pending: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} aria-label={`${enumLabel("referral", status)}: ${cards.length}`} className={`flex w-60 shrink-0 flex-col rounded-lg border p-2 ${isOver ? "border-accent bg-accent/5" : "border-border bg-surface-2"}`}>
      <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">{enumLabel("referral", status)}<Badge>{cards.length}</Badge></h2>
      <ul className="flex min-h-16 flex-col gap-2">{cards.map((c) => <Card key={c.id} c={c} onMove={onMove} pending={pending} />)}</ul>
    </section>
  );
}

export function ReferralBoard({ cards }: { cards: BoardCard[] }) {
  const [optimistic, setOptimistic] = useOptimistic(cards, (state, m: { id: string; to: string }) => state.map((c) => (c.id === m.id ? { ...c, status: m.to, allowed: [], daysInStage: 0 } : c)));
  const [error, setError] = useState<string>();
  const [hire, setHire] = useState<BoardCard | null>(null);
  const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  function move(c: BoardCard, to: string) {
    setError(undefined);
    if (!c.allowed.includes(to)) return setError(`${enumLabel("referral", c.status)} → ${enumLabel("referral", to)} isn't allowed for ${c.graduate.fullName}.${to === "graduate_interested" ? " Only the graduate can say they're interested." : ""}`);
    start(async () => {
      setOptimistic({ id: c.id, to });
      const r = await moveReferralAction(c.id, to);
      if (!r.ok) setError(r.error);
      else if (to === "hired") setHire(c);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const c = e.active.data.current as BoardCard | undefined;
    const to = e.over?.id as string | undefined;
    if (c && to && to !== c.status) move(c, to);
  }

  return (
    <>
      {error && <div className="mb-3"><Alert tone="danger">{error}</Alert></div>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}
        accessibility={{ announcements: {
          onDragStart: ({ active }) => `Picked up referral for ${(active.data.current as BoardCard).graduate.fullName}.`,
          onDragOver: ({ over }) => (over ? `Over ${enumLabel("referral", String(over.id))}.` : "Not over a stage."),
          onDragEnd: ({ over }) => (over ? `Dropped in ${enumLabel("referral", String(over.id))}.` : "Cancelled."),
          onDragCancel: () => "Move cancelled.",
        } }}>
        <div role="region" aria-label="Referral stages" tabIndex={0} className="relative flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((s) => <Column key={s} status={s} cards={optimistic.filter((c) => c.status === s)} onMove={move} pending={pending} />)}
        </div>
      </DndContext>
      <HireDialog card={hire} onClose={() => setHire(null)} />
    </>
  );
}

function HireDialog({ card, onClose }: { card: BoardCard | null; onClose: () => void }) {
  return (
    <Dialog.Root open={Boolean(card)} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-5 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">Confirm the employment record</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {card && <>A record was created for {card.graduate.fullName} at {card.opening.company} as {card.opening.title}. Check the details so the outcomes report is accurate.</>}
          </Dialog.Description>
          {card && <HireForm card={card} onDone={onClose} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HireForm({ card, onDone }: { card: BoardCard; onDone: () => void }) {
  const [s, act, pending] = useActionState(confirmHireAction.bind(null, card.id), { ok: false, error: "" } as ActionResult<null>);
  if (s.ok) return <div className="mt-4 space-y-3"><Alert tone="success">{s.message}</Alert><Button onClick={onDone}>Close</Button></div>;
  return (
    <form action={act} className="mt-4 grid gap-3">
      {!s.ok && s.error && <Alert tone="danger">{s.error}</Alert>}
      <Field id="employmentStatus" label="Employment type">
        <Select id="employmentStatus" name="employmentStatus" defaultValue="employed_full_time">
          {["employed_full_time", "employed_part_time", "freelance_contract", "internship"].map((v) => <option key={v} value={v}>{enumLabel("status", v)}</option>)}
        </Select>
      </Field>
      <Field id="roleTitle" label="Role title"><Input id="roleTitle" name="roleTitle" defaultValue={card.opening.title} /></Field>
      <Field id="startDate" label="Start date"><Input id="startDate" name="startDate" type="date" /></Field>
      <Field id="inField" label="In field?"><Select id="inField" name="inField" defaultValue="yes"><option value="yes">Yes</option><option value="no">No</option><option value="">Unknown</option></Select></Field>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>Confirm record</Button><Dialog.Close asChild><Button type="button" variant="ghost">Later</Button></Dialog.Close></div>
    </form>
  );
}
