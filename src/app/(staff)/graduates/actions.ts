"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import * as graduates from "@/server/services/graduates";
import { addEmploymentRecordAsStaff, verifyEmploymentRecord } from "@/server/services/employment";
import { sendProfileLinkAsStaff } from "@/server/services/surveys";

const FORM_OPTS = { arrays: ["preferredRoleCategories"], booleans: ["openToRelocate"], json: ["skills"] };

export async function createGraduateAction(...args: [_p: ActionResult<string>, fd: FormData]): Promise<ActionResult<string>> {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const res = await runAction(async () => graduates.createGraduate(await staffActionContext(), formToObject(fd, FORM_OPTS)));
  if (res.ok) redirect(`/graduates/${res.data}`);
  return res;
}

export async function updateGraduateAction(...args: [id: string, _p: ActionResult<string>, fd: FormData]): Promise<ActionResult<string>> {
  const [id, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const res = await runAction(async () => graduates.updateGraduate(await staffActionContext(), id, formToObject(fd, FORM_OPTS)));
  if (res.ok) redirect(`/graduates/${id}`);
  return res;
}

export async function revealContactAction(...args: [id: string]) {
  const [id] = parseArgs(z.tuple([A.id]), args);
  return runAction(async () => graduates.revealContact(await staffActionContext(), id));
}

export async function rotateLinkAction(...args: [id: string]) {
  const [id] = parseArgs(z.tuple([A.id]), args);
  const res = await runAction(async () => graduates.rotateProfileLink(await staffActionContext(), id), "All previous personal links for this graduate are now revoked.");
  revalidatePath(`/graduates/${id}`);
  return res;
}

export async function addRecordAction(...args: [id: string, _p: ActionResult<unknown>, fd: FormData]): Promise<ActionResult<unknown>> {
  const [id, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const raw = formToObject(fd);
  const input: Record<string, unknown> = { ...raw, inField: raw.inField === "yes" ? true : raw.inField === "no" ? false : undefined };
  for (const k of ["companyName", "roleTitle", "roleCategory", "employmentType", "salaryBand", "startDate", "endDate"]) if (input[k] === "") delete input[k];
  const res = await runAction(async () => { await addEmploymentRecordAsStaff(await staffActionContext(), id, input); return null; }, "Record added.");
  if (res.ok) revalidatePath(`/graduates/${id}`);
  return res;
}

export async function verifyRecordAction(...args: [graduateId: string, recordId: string]) {
  const [graduateId, recordId] = parseArgs(z.tuple([A.id, A.id, A.form.optional()]), args);
  await runAction(async () => verifyEmploymentRecord(await staffActionContext(), recordId));
  revalidatePath(`/graduates/${graduateId}`);
}

export async function sendLinkAction(...args: [id: string]) {
  const [id] = parseArgs(z.tuple([A.id]), args);
  const res = await runAction(async () => { await sendProfileLinkAsStaff(await staffActionContext(), id); return null; }, "A fresh personal link was emailed to the graduate.");
  revalidatePath(`/graduates/${id}`);
  return res;
}

export async function deleteGraduateAction(...args: [id: string, _p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [id, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const { deleteGraduateAsStaff } = await import("@/server/services/privacy");
  const r = await runAction(async () => { await deleteGraduateAsStaff(await staffActionContext(), id, fd.get("confirm")); return null; });
  if (r.ok) redirect("/graduates");
  return r;
}
