/**
 * Per-request Content-Security-Policy with a nonce: only scripts carrying this request's nonce
 * (Next.js applies it to its own scripts automatically) may run — no 'unsafe-inline' scripts.
 * Styles keep 'unsafe-inline' because chart/library inline styles need it; styles can't run code.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const https = (process.env.APP_URL ?? "").startsWith("https://");
  const sso = process.env.AUTH_OIDC_ISSUER ? ` ${new URL(process.env.AUTH_OIDC_ISSUER).origin}` : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Form posts may redirect to the SSO provider during staff sign-in.
    `form-action 'self'${sso}`,
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
