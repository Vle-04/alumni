"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { commitImport, previewImport } from "@/server/services/import";

export async function previewImportAction(fileName: string, text: string) {
  parseArgs(z.tuple([z.string().min(1).max(200), z.string().max(3_000_000)]), [fileName, text]);
  return runAction(async () => previewImport(await staffActionContext(), fileName, text));
}
export async function commitImportAction(batchId: string, text: string) {
  parseArgs(z.tuple([A.id, z.string().max(3_000_000)]), [batchId, text]);
  return runAction(async () => commitImport(await staffActionContext(), batchId, text));
}
