/**
 * Runs background jobs on hosts without a long-running worker (Netlify scheduled functions call
 * this; see netlify/functions). Protected by CRON_SECRET; disabled (404) when it is not set.
 * Every job is idempotent, so overlapping or repeated calls never duplicate effects.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validatedRoute } from "@/lib/route";
import { logger } from "@/server/logger";
import { opsAuthorized as authorized } from "@/server/ops/secret";
import { CRON_GROUPS, JOBS } from "@/worker/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

export const POST = validatedRoute(
  { params: z.object({ group: z.enum(["frequent", "daily"]) }).strict() },
  async (req, { params: { group } }) => {
    if (!process.env.CRON_SECRET) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const results: Record<string, unknown> = {};
    for (const name of CRON_GROUPS[group]) {
      const job = JOBS.find((j) => j.name === name)!;
      try {
        results[name] = await job.run();
      } catch (err) {
        logger.error("cron job failed", { job: name, err });
        results[name] = { error: true };
      }
    }
    return NextResponse.json({ ok: true, results });
  },
  () => NextResponse.json({ error: "not_found" }, { status: 404 }),
);
