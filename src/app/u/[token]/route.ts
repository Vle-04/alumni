/**
 * Entry point for every emailed personal link. GET only exchanges the token for a short-lived
 * session cookie and redirects to a clean URL (so the token never sits in history or is sent
 * onward as a referrer). GET has no other side effects, so email link scanners are harmless.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { checkRateLimit } from "@/server/rate-limit";
import { GRAD_SESSION_COOKIE, createSessionValue, resolveGraduateToken, sessionCookieOptions } from "@/server/tokens";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimit(`token:ip:${ip}`, 60, 15 * 60))) {
    return new NextResponse("Too many requests. Please wait a few minutes.", { status: 429, headers: { "Retry-After": "900" } });
  }
  const base = env().APP_URL;
  const r = await resolveGraduateToken(token, ["profile", "survey", "match"]);
  if (!r.ok) return noStore(NextResponse.redirect(new URL(`/link-expired?r=${r.reason}`, base), 303));

  const g = await prisma.graduate.findUniqueOrThrow({ where: { id: r.graduateId }, select: { id: true, profileTokenVersion: true } });
  const dest = r.purpose === "survey" && r.ref ? `/me/survey/${r.ref}` : r.purpose === "match" && r.ref ? `/me/matches/${r.ref}` : "/me";
  await audit(prisma, { actor: { type: "graduate", id: g.id }, ip, userAgent: req.headers.get("user-agent") }, { action: "link.open", entityType: "Graduate", entityId: g.id, meta: { purpose: r.purpose } });
  const res = NextResponse.redirect(new URL(dest, base), 303);
  res.cookies.set(GRAD_SESSION_COOKIE, createSessionValue(g), sessionCookieOptions());
  return noStore(res);
}

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store");
  return res;
}
