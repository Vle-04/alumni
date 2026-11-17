"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { createOpening, setOpeningStatus, updateOpening } from "@/server/services/openings";
import { notifyGraduate } from "@/server/services/placement";

const OPTS = { json: ["skills"] };

export async function createOpeningAction(...args: [_p: ActionResult<string>, fd: FormData]): Promise<ActionResult<string>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = await runAction(async () => createOpening(await staffActionContext(), formToObject(fd, OPTS)));
  if (r.ok) redirect(`/openings/${r.data}`);
  return r;
}
export async function updateOpeningAction(...args: [id: string, _p: ActionResult<string>, fd: FormData]): Promise<ActionResult<string>> {
  const [id, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const r = await runAction(async () => { await updateOpening(await staffActionContext(), id, formToObject(fd, OPTS)); return id; });
  if (r.ok) redirect(`/openings/${id}`);
  return r;
}
export async function openingStatusAction(...args: [id: string, action: "approve" | "reject" | "pause" | "reopen" | "close"]) {
  const [id, action] = parseArgs(z.tuple([A.id, z.enum(["approve", "reject", "pause", "reopen", "close"]), A.form.optional()]), args);
  await runAction(async () => setOpeningStatus(await staffActionContext(), id, action));
  revalidatePath(`/openings/${id}`);
  revalidatePath("/openings");
}
export async function notifyAction(...args: [openingId: string, graduateId: string]) {
  const [openingId, graduateId] = parseArgs(z.tuple([A.id, A.id]), args);
  const r = await runAction(async () => notifyGraduate(await staffActionContext(), openingId, graduateId), "Sent. The graduate can answer Interested or Not interested from the email.");
  revalidatePath(`/openings/${openingId}`);
  revalidatePath(`/graduates/${graduateId}`);
  return r;
}
