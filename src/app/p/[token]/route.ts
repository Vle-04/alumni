/** Partner portal entry: exchanges the emailed link for a short-lived session cookie. */
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { checkRateLimit } from "@/server/rate-limit";
import { PARTNER_SESSION_COOKIE, PARTNER_SESSION_SECONDS, partnerSessionValue, resolvePartner } from "@/server/services/partner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimit(`ptoken:ip:${ip}`, 60, 15 * 60))) return new NextResponse("Too many requests.", { status: 429 });
  const r = await resolvePartner((await params).token, "link");
  const base = env().APP_URL;
  if (!r.ok) return NextResponse.redirect(new URL(`/partner?expired=${r.reason}`, base), 303);
  const res = NextResponse.redirect(new URL("/partner", base), 303);
  res.cookies.set(PARTNER_SESSION_COOKIE, partnerSessionValue(r.contact), { httpOnly: true, sameSite: "lax", secure: base.startsWith("https://"), path: "/", maxAge: PARTNER_SESSION_SECONDS });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
