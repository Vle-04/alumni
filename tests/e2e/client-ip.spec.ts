/**
 * AUDIT 15, through the real custom server (production build). The e2e server runs with
 * TRUSTED_PROXY_HOPS=1, so this test acts as the trusted proxy: the rightmost x-forwarded-for entry
 * is "the client it saw"; everything to its left is client-controlled and must be ignored.
 */
import { expect, test } from "@playwright/test";
import { signToken } from "../../src/domain/tokens/signedToken";
import { db } from "./helpers";

const KEY = process.env.TOKEN_SIGNING_KEY!;
const link = (g: { id: string; profileTokenVersion: number }) => `/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "profile", exp: Math.floor(Date.now() / 1000) + 600 }, KEY)}`;

test("rotating the spoofable part of x-forwarded-for does not reset the lockout", async ({ request }) => {
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null } });
  const client = "198.51.100.77";
  for (let i = 0; i < 10; i++) {
    const r = await request.get(`/u/bad-${i}`, { maxRedirects: 0, headers: { "x-forwarded-for": `10.9.${i}.1, ${client}` } });
    expect(r.headers()["location"]).toMatch(/link-expired/);
  }
  const locked = await request.get(link(g), { maxRedirects: 0, headers: { "x-forwarded-for": `8.8.8.8, ${client}` } });
  expect(locked.status()).toBe(429);
  const other = await request.get(link(g), { maxRedirects: 0, headers: { "x-forwarded-for": "198.51.100.78" } });
  expect(other.status()).toBe(303); // a different client is unaffected
});

test("with 1 trusted hop the correct address is used, and a client-sent internal header is overwritten", async ({ request }) => {
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null } });
  const before = new Date();
  const r = await request.get(link(g), { maxRedirects: 0, headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.200", "x-alumni-client-ip": "7.7.7.7" } });
  expect(r.status()).toBe(303);
  const a = await db.auditLog.findFirstOrThrow({ where: { action: "link.open", entityId: g.id, at: { gte: before } }, orderBy: { at: "desc" } });
  expect(a.ip).toBe("203.0.113.200");
});
