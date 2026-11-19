/**
 * AUDIT 20: against the production build served over real HTTPS, the actual Set-Cookie headers
 * for staff sessions (password sign-in), graduate sessions and partner sessions are Secure, HttpOnly and SameSite.
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

test("staff session cookie (email + password sign-in over HTTPS)", async ({ page, context }) => {
  const csrfRes = await page.request.get("/api/auth/csrf");
  expectHardened(cookie(csrfRes, "__Host-authjs.csrf-token"));

  await page.goto("/login");
  await page.getByLabel("Email").fill("careers@academy.example");
  await page.getByLabel("Password").fill(process.env.SEED_STAFF_PASSWORD || "alumni-dev-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");

  const session = (await context.cookies()).find((c) => c.name === "__Secure-authjs.session-token");
  expect(session, "staff session cookie").toBeTruthy();
  expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
  // and it really signs the user in over HTTPS
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(200);
});

test("password-reset links always point at APP_URL, whatever Host the request claims", async ({ page }) => {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  await page.setExtraHTTPHeaders({ "x-forwarded-host": "evil.example" });
  await page.goto("/login/forgot");
  await page.getByLabel("Email").fill("careers2@academy.example");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByText("a link to reset the password is on its way")).toBeVisible();

  let link = "";
  for (let i = 0; i < 30 && !link; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const msg = list.messages.find((m) => m.To[0]?.Address === "careers2@academy.example");
    if (msg) link = ((await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { Text: string }).Text.match(/https:\/\/\S+/)![0];
    else await new Promise((r) => setTimeout(r, 300));
  }
  expect(link.startsWith("https://localhost:8443/login/reset?token=")).toBe(true);
  expect(link).not.toContain("evil.example");
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
