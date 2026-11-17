/** GET /api/reports/export?format=csv|pdf&<filters> — aggregates only; every export is audited. */
import { NextResponse, type NextRequest } from "next/server";
import { getStaffContext } from "@/server/session";
import { exportReport } from "@/server/services/reports";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "csv";
  const filters = { programId: sp.get("programId"), cohortId: sp.get("cohortId"), from: sp.get("from"), to: sp.get("to"), count: sp.getAll("count").length ? sp.getAll("count") : undefined, inField: sp.get("inField") };
  try {
    const out = await exportReport(ctx, filters, format);
    return new NextResponse(new Uint8Array(typeof out.body === "string" ? Buffer.from(out.body, "utf8") : out.body), {
      headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
