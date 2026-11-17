"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { acceptMerge, rejectMerge } from "@/server/services/companies";

export async function acceptMergeAction(id: string) {
  parseArgs(z.tuple([A.id, A.form.optional()]), [id]);
  await runAction(async () => acceptMerge(await staffActionContext(), id));
  revalidatePath("/companies");
}
export async function rejectMergeAction(id: string) {
  parseArgs(z.tuple([A.id, A.form.optional()]), [id]);
  await runAction(async () => rejectMerge(await staffActionContext(), id));
  revalidatePath("/companies");
}
