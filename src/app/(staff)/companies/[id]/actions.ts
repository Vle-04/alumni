"use server";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { createPartnerContact, issuePartnerLink } from "@/server/services/partner";
import { updateCompany } from "@/server/services/companies";

export async function addContactAction(companyId: string, _p: ActionResult<string>, fd: FormData): Promise<ActionResult<string>> {
  const r = await runAction(async () => createPartnerContact(await staffActionContext(), companyId, formToObject(fd)), "Contact added.");
  revalidatePath(`/companies/${companyId}`);
  return r;
}
export async function issueLinkAction(contactId: string, rotate: boolean) {
  return runAction(async () => issuePartnerLink(await staffActionContext(), contactId, rotate));
}
export async function updateCompanyAction(id: string, _p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => { await updateCompany(await staffActionContext(), id, formToObject(fd, { booleans: ["isPartner"] })); return null; }, "Saved.");
  revalidatePath(`/companies/${id}`);
  return r;
}
