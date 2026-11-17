/** GET /api/reports/export?format=csv|pdf&<filters> — aggregates only; every export is audited. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffContext } from "@/server/session";
import { exportReport, reportFiltersStrictSchema } from "@/server/services/reports";
import { AppError } from "@/server/errors";
import { validatedRoute } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Strict: unknown parameters and malformed values are rejected with 422 (nothing is silently dropped). */
const exportQuerySchema = reportFiltersStrictSchema.extend({
  format: z.enum(["csv", "pdf"]).default("csv"),
  count: z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), reportFiltersStrictSchema.shape.count),
  inField: z.literal("1").optional().transform((v) => v === "1"),
}).strict();

export const GET = validatedRoute({ query: exportQuerySchema }, async (_req, { query }) => {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { format, ...filters } = query;
  try {
    const out = await exportReport(ctx, filters, format);
    return new NextResponse(new Uint8Array(typeof out.body === "string" ? Buffer.from(out.body, "utf8") : out.body), {
      headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
});
