"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { commitImport, previewImport } from "@/server/services/import";

export async function previewImportAction(...args: [fileName: string, text: string]) {
  const [fileName, text] = parseArgs(z.tuple([z.string().min(1).max(200), z.string().max(3_000_000)]), args);
  return runAction(async () => previewImport(await staffActionContext(), fileName, text));
}
export async function commitImportAction(...args: [batchId: string, text: string]) {
  const [batchId, text] = parseArgs(z.tuple([A.id, z.string().max(3_000_000)]), args);
  return runAction(async () => commitImport(await staffActionContext(), batchId, text));
}
