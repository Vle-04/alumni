"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { acceptMerge, rejectMerge } from "@/server/services/companies";

export async function acceptMergeAction(...args: [id: string]) {
  const [id] = parseArgs(z.tuple([A.id, A.form.optional()]), args);
  await runAction(async () => acceptMerge(await staffActionContext(), id));
  revalidatePath("/companies");
}
export async function rejectMergeAction(...args: [id: string]) {
  const [id] = parseArgs(z.tuple([A.id, A.form.optional()]), args);
  await runAction(async () => rejectMerge(await staffActionContext(), id));
  revalidatePath("/companies");
}
