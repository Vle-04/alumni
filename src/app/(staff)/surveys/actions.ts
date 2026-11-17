"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { dismissDeadLetter, retryDeadLetter } from "@/server/services/surveys";

export async function retryAction(id: string) {
  await runAction(async () => retryDeadLetter(await staffActionContext(), id));
  revalidatePath("/surveys");
}
export async function dismissAction(id: string) {
  await runAction(async () => dismissDeadLetter(await staffActionContext(), id));
  revalidatePath("/surveys");
}
