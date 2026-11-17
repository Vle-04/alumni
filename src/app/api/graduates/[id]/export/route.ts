/** Admin: subject-access export for a graduate (audited). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffContext } from "@/server/session";
import { exportGraduateDataAsStaff } from "@/server/services/privacy";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) }).safeParse(await params);
  if (!p.success) return NextResponse.json({ error: "validation" }, { status: 422 });
  try {
    const data = await exportGraduateDataAsStaff(ctx, p.data.id);
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="graduate-data.json"', "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
