/**
 * AUDIT 20: against the production build served over real HTTPS, the actual Set-Cookie headers
 * for staff sessions, graduate sessions and partner sessions are Secure, HttpOnly and SameSite.
 */
import { expect, test, type APIResponse } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../../src/domain/tokens/signedToken";

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const KEY = process.env.TOKEN_SIGNING_KEY!;
const MAILPIT = "http://localhost:8025";
const exp = () => Math.floor(Date.now() / 1000) + 600;

function cookie(res: APIResponse, name: string): string {
  const line = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).find((v) => v.startsWith(`${name}=`));
  expect(line, `Set-Cookie for ${name}`).toBeTruthy();
  return line!;
}
function expectHardened(line: string, sameSite: RegExp = /SameSite=Lax/i) {
  expect(line).toMatch(/;\s*Secure(;|$)/i);
  expect(line).toMatch(/;\s*HttpOnly(;|$)/i);
  expect(line).toMatch(sameSite);
}

test.afterAll(() => db.$disconnect());

test("staff session cookie (magic-link sign-in over HTTPS)", async ({ request }) => {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  const csrfRes = await request.get("/api/auth/csrf");
  expectHardened(cookie(csrfRes, "__Host-authjs.csrf-token"));
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  // A forged host header must not change where the emailed link points (host-header poisoning).
  await request.post("/api/auth/signin/email", { form: { csrfToken, email: "careers@academy.example", callbackUrl: "/" }, maxRedirects: 0, headers: { "x-forwarded-host": "evil.example" } });

  let link = "";
  for (let i = 0; i < 30 && !link; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const msg = list.messages.find((m) => m.To[0]?.Address === "careers@academy.example");
    if (msg) link = ((await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { Text: string }).Text.match(/https:\/\/\S+/)![0];
    else await new Promise((r) => setTimeout(r, 300));
  }
  expect(link.startsWith("https://localhost:8443/api/auth/callback/email")).toBe(true);
  expect(link).not.toContain("evil.example");
  const callback = await request.get(link, { maxRedirects: 0 });
  expect(callback.status()).toBe(302);
  const session = cookie(callback, "__Secure-authjs.session-token");
  expectHardened(session);
  // and it really signs the user in over HTTPS
  expect((await request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(200);
});

test("graduate session cookie (personal link over HTTPS)", async ({ request }) => {
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null } });
  const res = await request.get(`/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "profile", exp: exp() }, KEY)}`, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expectHardened(cookie(res, "alumni_grad"));
});

test("partner session cookie (portal link over HTTPS)", async ({ request }) => {
  const c = await db.partnerContact.findFirstOrThrow({ where: { active: true, company: { isPartner: true } } });
  const res = await request.get(`/p/${signToken({ sub: c.id, v: c.tokenVersion, p: "partner", exp: exp() }, KEY)}`, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expectHardened(cookie(res, "alumni_partner"));
});

test("behind the TLS proxy, the client IP is the proxy-reported one (1 trusted hop), not a spoofed header", async ({ request }) => {
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null } });
  const before = new Date();
  await request.get(`/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "profile", exp: exp() }, KEY)}`, { maxRedirects: 0, headers: { "x-forwarded-for": "6.6.6.6", "x-alumni-client-ip": "7.7.7.7" } });
  const a = await db.auditLog.findFirstOrThrow({ where: { action: "link.open", entityId: g.id, at: { gte: before } }, orderBy: { at: "desc" } });
  expect(a.ip).not.toBe("6.6.6.6");
  expect(a.ip).not.toBe("7.7.7.7");
  expect(a.ip).toMatch(/^(\d+\.){3}\d+$|:/); // the address Caddy saw (the Docker gateway)
});
