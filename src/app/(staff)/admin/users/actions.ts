"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { inviteUser, updateUser } from "@/server/services/users";

export async function inviteUserAction(...args: [_p: ActionResult<string>, fd: FormData]) {
  const [_p, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const r = await runAction(async () => inviteUser(await staffActionContext(), formToObject(fd)), "Invitation saved. They can now sign in with their email.");
  revalidatePath("/admin/users");
  return r;
}
export async function updateUserAction(...args: [id: string, fd: FormData]) {
  const [id, fd] = parseArgs(z.tuple([A.id, A.form]), args);
  await runAction(async () => updateUser(await staffActionContext(), id, { role: fd.get("role"), active: fd.get("active") === "on" }));
  revalidatePath("/admin/users");
}
