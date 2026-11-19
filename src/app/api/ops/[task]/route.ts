/**
 * Deployment maintenance, called by scripts/deploy-netlify.sh with Bearer CRON_SECRET:
 *   POST /api/ops/migrate        apply pending Prisma migrations with the app's (owner) DB connection
 *   POST /api/ops/create-admin   {email, name} — only while no admin exists (first deployment)
 * Disabled (404) when CRON_SECRET is not set.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { validatedRoute } from "@/lib/route";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { ConflictError } from "@/server/errors";
import { opsAuthorized, opsEnabled } from "@/server/ops/secret";
import { applyPendingMigrations } from "@/server/ops/migrate";
import { bootstrapFirstAdmin } from "@/server/ops/bootstrap-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const adminBody = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), name: z.string().trim().min(1).max(100) }).strict();

export const POST = validatedRoute(
  {
    params: z.object({ task: z.enum(["migrate", "create-admin"]) }).strict(),
    body: z.object({ email: z.string().max(320), name: z.string().max(100) }).partial().strict(),
  },
  async (req, { params: { task }, body }) => {
    if (!opsEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!opsAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      if (task === "migrate") {
        const report = await applyPendingMigrations(env().DATABASE_URL);
        logger.info("ops: migrations", { applied: report.applied, mismatch: report.checksumMismatch });
        return NextResponse.json({ ok: true, ...report });
      }
      const input = adminBody.safeParse(body);
      if (!input.success) return NextResponse.json({ error: "validation" }, { status: 422 });
      return NextResponse.json({ ok: true, ...(await bootstrapFirstAdmin(input.data)) });
    } catch (err) {
      if (err instanceof ConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
      logger.error("ops task failed", { task, err });
      return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
    }
  },
  () => NextResponse.json({ error: "not_found" }, { status: 404 }),
);
