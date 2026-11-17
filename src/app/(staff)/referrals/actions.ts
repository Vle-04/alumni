"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { REFERRAL_STATUSES } from "@/domain/enums";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { confirmHire, moveReferral } from "@/server/services/placement";

export async function moveReferralAction(...args: [id: string, to: string, note?: string]) {
  const [id, to, note] = parseArgs(z.tuple([A.id, z.enum(REFERRAL_STATUSES), z.string().max(500).optional()]), args);
  const r = await runAction(async () => moveReferral(await staffActionContext(), id, to, note));
  revalidatePath("/referrals");
  return r;
}
export async function confirmHireAction(...args: [referralId: string, _p: ActionResult<null>, fd: FormData]): Promise<ActionResult<null>> {
  const [referralId, _p, fd] = parseArgs(z.tuple([A.id, A.prev, A.form]), args);
  const r = await runAction(async () => { await confirmHire(await staffActionContext(), referralId, formToObject(fd)); return null; }, "Employment record confirmed.");
  revalidatePath("/referrals");
  return r;
}
