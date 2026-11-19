/**
 * Per-request Content-Security-Policy with a nonce: only scripts carrying this request's nonce
 * (Next.js applies it to its own scripts automatically) may run — no 'unsafe-inline' scripts.
 * Styles keep 'unsafe-inline' because chart/library inline styles need it; styles can't run code.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Paths with their own CSRF defence: Auth.js (CSRF token), RFC 8058 unsubscribe (token in URL, mail clients send no Origin), cron/ops (bearer secret, no cookies). */
const CSRF_EXEMPT = ["/api/auth/", "/api/unsubscribe/", "/api/cron/", "/api/ops/"];

/**
 * CSRF: any state-changing request must come from this site. Browsers always send Origin on
 * POST; a missing or foreign Origin is refused. (Next.js also checks server-action origins —
 * this is defence in depth and covers route handlers too.)
 */
export function isCrossSite(request: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  if (CSRF_EXEMPT.some((p) => request.nextUrl.pathname.startsWith(p))) return false;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest) {
  if (isCrossSite(request)) return new NextResponse("Cross-site request refused.", { status: 403 });
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const https = (process.env.APP_URL ?? "").startsWith("https://");
  const sso = process.env.AUTH_OIDC_ISSUER ? ` ${new URL(process.env.AUTH_OIDC_ISSUER).origin}` : "";
  const google = process.env.GOOGLE_CLIENT_ID ? " https://accounts.google.com" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Form posts may redirect to Google / the SSO provider during staff sign-in.
    `form-action 'self'${sso}${google}`,
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Skip static assets and prefetches; everything else (pages, actions, API) gets the header.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|graduates-template.csv).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
