"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { createPartnerContact, issuePartnerLink } from "@/server/services/partner";
import { updateCompany } from "@/server/services/companies";

export async function addContactAction(...args: [companyId: string, _p: ActionResult<string>, fd: FormData]): Promise<ActionResult<string>> {
  const [companyId, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const r = await runAction(async () => createPartnerContact(await staffActionContext(), companyId, formToObject(fd)), "Contact added.");
  revalidatePath(`/companies/${companyId}`);
  return r;
}
export async function issueLinkAction(...args: [contactId: string, rotate: boolean]) {
  const [contactId, rotate] = parseArgs(z.tuple([A.id, z.boolean()]), args);
  return runAction(async () => issuePartnerLink(await staffActionContext(), String(contactId), rotate === true));
}
export async function updateCompanyAction(...args: [id: string, _p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [id, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const r = await runAction(async () => { await updateCompany(await staffActionContext(), id, formToObject(fd, { booleans: ["isPartner"] })); return null; }, "Saved.");
  revalidatePath(`/companies/${id}`);
  return r;
}
