"use server";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { inviteUser, updateUser } from "@/server/services/users";

export async function inviteUserAction(_p: ActionResult<string>, fd: FormData) {
  const r = await runAction(async () => inviteUser(await staffActionContext(), formToObject(fd)), "Invitation saved. They can now sign in with their email.");
  revalidatePath("/admin/users");
  return r;
}
export async function updateUserAction(id: string, fd: FormData) {
  await runAction(async () => updateUser(await staffActionContext(), id, { role: fd.get("role"), active: fd.get("active") === "on" }));
  revalidatePath("/admin/users");
}
