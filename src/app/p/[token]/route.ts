/** Partner portal entry: exchanges the emailed link for a short-lived session cookie. */
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { checkRateLimit } from "@/server/rate-limit";
import { isLockedOut, recordFailure, retryAfterSeconds } from "@/server/lockout";
import { z } from "zod";
import { PARTNER_SESSION_COOKIE, partnerCookieOptions, partnerSessionValue, resolvePartner } from "@/server/services/partner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimit(`ptoken:ip:${ip}`, 60, 15 * 60))) return new NextResponse("Too many requests.", { status: 429 });
  if (await isLockedOut("partnerLink", ip)) return new NextResponse("Too many invalid links. Please wait and try again.", { status: 429, headers: { "Retry-After": String(retryAfterSeconds("partnerLink")) } });
  const parsed = z.object({ token: z.string().min(1).max(1024) }).safeParse(await params);
  const r = parsed.success ? await resolvePartner(parsed.data.token, "link") : ({ ok: false, reason: "invalid" } as const);
  const base = env().APP_URL;
  if (!r.ok) {
    await recordFailure("partnerLink", ip);
    return NextResponse.redirect(new URL(`/partner?expired=${r.reason}`, base), 303);
  }
  const res = NextResponse.redirect(new URL("/partner", base), 303);
  res.cookies.set(PARTNER_SESSION_COOKIE, partnerSessionValue(r.contact), partnerCookieOptions());
  res.headers.set("Cache-Control", "no-store");
  return res;
}
