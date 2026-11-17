"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { dismissDeadLetter, retryDeadLetter } from "@/server/services/surveys";

export async function retryAction(id: string) {
  parseArgs(z.tuple([A.id, A.form.optional()]), [id]);
  await runAction(async () => retryDeadLetter(await staffActionContext(), id));
  revalidatePath("/surveys");
}
export async function dismissAction(id: string) {
  parseArgs(z.tuple([A.id, A.form.optional()]), [id]);
  await runAction(async () => dismissDeadLetter(await staffActionContext(), id));
  revalidatePath("/surveys");
}
