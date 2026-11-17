/** Admin: subject-access export for a graduate (audited). */
import { NextResponse } from "next/server";
import { getStaffContext } from "@/server/session";
import { exportGraduateDataAsStaff } from "@/server/services/privacy";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const data = await exportGraduateDataAsStaff(ctx, (await params).id);
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="graduate-data.json"', "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
