"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { acceptMerge, rejectMerge } from "@/server/services/companies";

export async function acceptMergeAction(id: string) {
  await runAction(async () => acceptMerge(await staffActionContext(), id));
  revalidatePath("/companies");
}
export async function rejectMergeAction(id: string) {
  await runAction(async () => rejectMerge(await staffActionContext(), id));
  revalidatePath("/companies");
}
