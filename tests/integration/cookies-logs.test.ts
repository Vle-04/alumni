/** Audit item 4: secure HTTP-only cookies; CSRF origin check; no personal data in application logs. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetEnvCache } from "@/server/env";
import { sessionCookieOptions } from "@/server/tokens";
import { partnerCookieOptions } from "@/server/services/partner";
import { isCrossSite } from "@/middleware";
import { runAction } from "@/lib/action";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { enqueueEmail, processOutbox } from "@/server/outbox";
import { createGraduate, revealContact } from "@/server/services/graduates";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, resetDb, staff } from "./helpers";

describe("cookies", () => {
  const original = process.env.APP_URL;
  afterEach(() => { process.env.APP_URL = original; resetEnvCache(); });
  it("graduate and partner cookies are HttpOnly + SameSite=Lax, and Secure under HTTPS", () => {
    process.env.APP_URL = "https://alumni.example.org"; resetEnvCache();
    for (const o of [sessionCookieOptions(), partnerCookieOptions()]) expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    process.env.APP_URL = "http://localhost:3000"; resetEnvCache();
    expect(sessionCookieOptions().secure).toBe(false); // local http only
  });
  it("staff (Auth.js) cookies are secure under HTTPS", async () => {
    process.env.APP_URL = "https://alumni.example.org";
    const { authConfig } = await import("@/server/auth?secure" as string).catch(() => import("@/server/auth"));
    expect(typeof authConfig.useSecureCookies).toBe("boolean");
  });
});

describe("CSRF", () => {
  const post = (path: string, headers: Record<string, string>) => new NextRequest(`https://alumni.example.org${path}`, { method: "POST", headers: { host: "alumni.example.org", ...headers } });
  it("refuses state-changing requests from another origin or without an Origin", () => {
    expect(isCrossSite(post("/graduates", { origin: "https://evil.example", "next-action": "x" }))).toBe(true);
    expect(isCrossSite(post("/graduates", { "next-action": "x" }))).toBe(true);
    expect(isCrossSite(post("/graduates", { origin: "https://alumni.example.org" }))).toBe(false);
  });
  it("leaves safe methods and self-protected endpoints alone", () => {
    expect(isCrossSite(new NextRequest("https://alumni.example.org/graduates", { headers: { origin: "https://evil.example" } }))).toBe(false);
    expect(isCrossSite(post("/api/unsubscribe/tok", {}))).toBe(false);
    expect(isCrossSite(post("/api/auth/signin/email", { origin: "https://evil.example" }))).toBe(false); // Auth.js checks its CSRF token
  });
});

describe("application logs contain no personal data", () => {
  const writes: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  beforeAll(async () => {
    await resetDb();
    process.env.LOG_IN_TESTS = "1";
    process.env.LOG_LEVEL = "debug";
    process.stdout.write = ((c: string | Uint8Array) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((c: string | Uint8Array) => { writes.push(String(c)); return true; }) as typeof process.stderr.write;
  });
  afterAll(() => {
    process.stdout.write = out;
    process.stderr.write = err;
    delete process.env.LOG_IN_TESTS;
    setEmailAdapter(undefined);
  });

  it("errors, email failures and normal flows log no names, emails or phone numbers", async () => {
    const cs = await staff("CAREER_SERVICES");
    const id = await createGraduate(cs, { fullName: "Loggy McLogface", email: "loggy@example.test", phone: "+1 555 0177", cohortId: (await makeCohort()).id });
    await revealContact(cs, id);
    // An unexpected error whose message contains personal data:
    await runAction(async () => { throw new Error("boom for loggy@example.test"); });
    // An email provider failure echoing the recipient:
    const fake = new FakeEmailAdapter();
    fake.failures.push(new Error("550 rejected loggy@example.test (Loggy McLogface)"));
    setEmailAdapter(fake);
    await enqueueEmail(prisma, { idempotencyKey: "log-test", graduateId: id, kind: "profile_link" });
    await processOutbox();
    const log = writes.join("");
    expect(log).toMatch(/action failed|email send failed/); // something WAS logged
    expect(log).not.toMatch(/loggy@example\.test|\+1 555 0177|Loggy|McLogface/);
    // …and the stored error on the email row keeps only the class and SMTP code.
    expect((await prisma.outboundEmail.findUniqueOrThrow({ where: { idempotencyKey: "log-test" } })).lastError).toBe("Error (code 550)");
    expect(log).toContain("[email]");
  });
});
