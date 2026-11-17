/** RFC 8058 one-click unsubscribe (mail clients POST here from the List-Unsubscribe header). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveGraduateToken } from "@/server/tokens";
import { unsubscribeByToken } from "@/server/services/self-service";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = z.object({ token: z.string().min(1).max(1024) }).safeParse(await params);
  const r = p.success ? await resolveGraduateToken(p.data.token, ["unsubscribe"]) : null;
  if (!r?.ok) return NextResponse.json({ ok: false }, { status: 400 });
  await unsubscribeByToken(r.graduateId);
  return NextResponse.json({ ok: true });
}
