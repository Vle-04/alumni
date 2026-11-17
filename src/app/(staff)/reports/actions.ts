"use server";
import { parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { staffActionContext } from "@/server/session";
import { logChartExport } from "@/server/services/reports";

export async function logChartExportAction(chart: string, filters: Record<string, unknown>) {
  parseArgs(z.tuple([z.string().max(60).regex(/^[a-z0-9-]+$/), z.record(z.string(), z.unknown())]), [chart, filters]);
  await logChartExport(await staffActionContext("report:export"), chart, filters);
}
