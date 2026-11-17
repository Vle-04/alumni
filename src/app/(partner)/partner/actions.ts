"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { getPartnerContext } from "@/server/partner-session";
import { submitOpeningAsPartner } from "@/server/services/openings";
import { ForbiddenError } from "@/server/errors";

export async function submitOpeningAction(_p: ActionResult<string>, fd: FormData): Promise<ActionResult<string>> {
  parseArgs(z.tuple([A.prev, A.form]), [_p, fd]);
  const r = await runAction(async () => {
    const ctx = await getPartnerContext();
    if (!ctx) throw new ForbiddenError("Your link has expired. Ask the Academy careers team for a new one.");
    return submitOpeningAsPartner(ctx, formToObject(fd, { json: ["skills"] }));
  }, "Thanks! The Academy will review the opening shortly.");
  revalidatePath("/partner");
  return r;
}
