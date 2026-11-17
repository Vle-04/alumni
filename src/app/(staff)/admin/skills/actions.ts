"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { addSynonym, mergeSkillInto, removeSynonym } from "@/server/services/skills-admin";

export async function addSynonymAction(skillId: string, _p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  parseArgs(z.tuple([A.id, A.prev, A.form]), [skillId, _p, fd]);
  const r = await runAction(async () => { await addSynonym(await staffActionContext(), skillId, fd.get("alias")); return null; });
  revalidatePath("/admin/skills");
  return r;
}
export async function removeSynonymAction(id: string) {
  parseArgs(z.tuple([A.id, A.form.optional()]), [id]);
  await runAction(async () => removeSynonym(await staffActionContext(), id));
  revalidatePath("/admin/skills");
}
export async function mergeSkillAction(_p: ActionResult<null>, fd: FormData): Promise<ActionResult<null>> {
  parseArgs(z.tuple([A.prev, A.form]), [_p, fd]);
  const r = await runAction(async () => { await mergeSkillInto(await staffActionContext(), String(fd.get("sourceId")), String(fd.get("targetId"))); return null; }, "Merged. The old name now works as a synonym.");
  revalidatePath("/admin/skills");
  return r;
}
