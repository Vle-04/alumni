"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { createCohort, createProgram, updateCohort } from "@/server/services/cohorts";

export async function createCohortAction(...args: [_p: ActionResult<string>, fd: FormData]) {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = await runAction(async () => createCohort(await staffActionContext(), formToObject(fd)), "Cohort created.");
  revalidatePath("/cohorts");
  return r;
}
export async function updateCohortAction(...args: [id: string, _p: ActionResult<string>, fd: FormData]) {
  const [id, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const r = await runAction(async () => updateCohort(await staffActionContext(), id, formToObject(fd)), "Cohort saved. Survey schedules were updated.");
  revalidatePath("/cohorts");
  return r;
}
export async function createProgramAction(...args: [_p: ActionResult<string>, fd: FormData]) {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = await runAction(async () => createProgram(await staffActionContext(), String(fd.get("name") ?? "")), "Program created.");
  revalidatePath("/cohorts");
  return r;
}
