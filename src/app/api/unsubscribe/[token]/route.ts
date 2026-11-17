/** RFC 8058 one-click unsubscribe (mail clients POST "List-Unsubscribe=One-Click" here). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveGraduateToken } from "@/server/tokens";
import { unsubscribeByToken } from "@/server/services/self-service";
import { tokenParam, validatedRoute } from "@/lib/route";

export const POST = validatedRoute(
  { params: tokenParam, body: z.object({ "List-Unsubscribe": z.literal("One-Click").optional() }).strict() },
  async (_req, { params: { token } }) => {
    const r = await resolveGraduateToken(token, ["unsubscribe"]);
    if (!r.ok) return NextResponse.json({ ok: false }, { status: 400 });
    await unsubscribeByToken(r.graduateId);
    return NextResponse.json({ ok: true });
  },
  () => NextResponse.json({ ok: false }, { status: 400 }),
);
