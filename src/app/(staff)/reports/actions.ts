"use server";
import { staffActionContext } from "@/server/session";
import { logChartExport } from "@/server/services/reports";

export async function logChartExportAction(chart: string, filters: Record<string, unknown>) {
  await logChartExport(await staffActionContext("report:export"), chart, filters);
}
