"use server";
import { runAction } from "@/lib/action";
import { staffActionContext } from "@/server/session";
import { commitImport, previewImport } from "@/server/services/import";

export async function previewImportAction(fileName: string, text: string) {
  return runAction(async () => previewImport(await staffActionContext(), fileName, text));
}
export async function commitImportAction(batchId: string, text: string) {
  return runAction(async () => commitImport(await staffActionContext(), batchId, text));
}
