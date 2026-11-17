"use server";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { confirmHire, moveReferral } from "@/server/services/placement";

export async function moveReferralAction(id: string, to: string, note?: string) {
  const r = await runAction(async () => moveReferral(await staffActionContext(), id, to, note));
  revalidatePath("/referrals");
  return r;
}
export async function confirmHireAction(referralId: string, _p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => { await confirmHire(await staffActionContext(), referralId, formToObject(fd)); return null; }, "Employment record confirmed.");
  revalidatePath("/referrals");
  return r;
}
