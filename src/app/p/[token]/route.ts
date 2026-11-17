/** Partner portal entry: exchanges the emailed link for a short-lived session cookie. */
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { checkRateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/client-ip";
import { isLockedOut, recordFailure, retryAfterSeconds } from "@/server/lockout";
import { PARTNER_SESSION_COOKIE, partnerCookieOptions, partnerSessionValue, resolvePartner } from "@/server/services/partner";
import { tokenParam, validatedRoute } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = validatedRoute(
  { params: tokenParam },
  async (req, { params: { token } }) => {
    const ip = clientIp(req.headers);
    if (!ip) return new NextResponse("We couldn't verify your network address. Please try again.", { status: 400 });
    if (!(await checkRateLimit(`ptoken:ip:${ip}`, 60, 15 * 60))) return new NextResponse("Too many requests.", { status: 429 });
    if (await isLockedOut("partnerLink", ip)) return new NextResponse("Too many invalid links. Please wait and try again.", { status: 429, headers: { "Retry-After": String(await retryAfterSeconds("partnerLink")) } });
    const r = await resolvePartner(token, "link");
    const base = env().APP_URL;
    if (!r.ok) {
      await recordFailure("partnerLink", ip);
      return NextResponse.redirect(new URL(`/partner?expired=${r.reason}`, base), 303);
    }
    const res = NextResponse.redirect(new URL("/partner", base), 303);
    res.cookies.set(PARTNER_SESSION_COOKIE, partnerSessionValue(r.contact), partnerCookieOptions());
    res.headers.set("Cache-Control", "no-store");
    return res;
  },
  () => NextResponse.redirect(new URL("/partner?expired=invalid", env().APP_URL), 303),
);
