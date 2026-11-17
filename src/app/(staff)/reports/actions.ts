"use server";
import { parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { staffActionContext } from "@/server/session";
import { cappedStrictFilters, logChartExport } from "@/server/services/reports";

export async function logChartExportAction(...args: [chart: string, filters: unknown]) {
  const [chart, filters] = parseArgs(z.tuple([z.string().max(60).regex(/^[a-z0-9-]+$/), cappedStrictFilters]), args);
  await logChartExport(await staffActionContext("report:export"), chart, filters);
}
