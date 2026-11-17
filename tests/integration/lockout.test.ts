/**
 * Audit item 1: rate limits AND lockout after repeated failures on graduate links, partner
 * portal links and every 6-digit code (email change, export, delete).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { RateLimitError, ValidationError } from "@/server/errors";
import { GET as gradLink } from "@/app/u/[token]/route";
import { GET as partnerLinkRoute } from "@/app/p/[token]/route";
import { createGraduateToken } from "@/server/tokens";
import { partnerLink } from "@/server/services/partner";
import { changeEmail, requestOtp } from "@/server/services/self-service";
import { deleteMyAccount, exportMyData } from "@/server/services/privacy";
import { blindIndex, encrypt } from "@/server/crypto";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, makeGraduate, resetDb } from "./helpers";

// The custom server (server.ts) resolves the client IP from the socket and passes it in this header;
// x-forwarded-for is client-controlled noise as far as the app is concerned.
const req = (path: string, ip: string | null, spoofedXff = "") =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { ...(ip ? { "x-alumni-client-ip": ip } : {}), ...(spoofedXff ? { "x-forwarded-for": spoofedXff } : {}) } });
const call = (route: typeof gradLink, token: string, ip: string | null, prefix = "/u/", spoofedXff = "") => route(req(`${prefix}${token}`, ip, spoofedXff), { params: Promise.resolve({ token }) });

describe("lockout after repeated failures", () => {
  let fake: FakeEmailAdapter;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
  });
  afterEach(() => setEmailAdapter(undefined));

  it("graduate links: 10 bad tokens from one IP lock that IP out, even for a valid link", async () => {
    const g = await makeGraduate((await makeCohort()).id);
    const good = createGraduateToken(g, "profile");
    expect((await call(gradLink, good, "1.1.1.1")).status).toBe(303); // works before
    for (let i = 0; i < 10; i++) expect((await call(gradLink, `bad${i}`, "1.1.1.1")).headers.get("location")).toMatch(/link-expired/);
    const locked = await call(gradLink, good, "1.1.1.1");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call(gradLink, good, "2.2.2.2")).status).toBe(303); // other IPs unaffected
  });

  it("AUDIT 15: a rotated / spoofed x-forwarded-for does NOT reset the lockout", async () => {
    const g = await makeGraduate((await makeCohort()).id);
    const good = createGraduateToken(g, "profile");
    for (let i = 0; i < 10; i++) await call(gradLink, `bad${i}`, "5.5.5.5", "/u/", `10.0.0.${i}, 172.16.0.${i}`);
    expect((await call(gradLink, good, "5.5.5.5", "/u/", "8.8.8.8")).status).toBe(429);
    expect((await call(gradLink, good, "5.5.5.5", "/u/", "")).status).toBe(429);
  });

  it("AUDIT 15: requests with no usable client IP are refused (no shared 'unknown' bucket)", async () => {
    const g = await makeGraduate((await makeCohort()).id);
    const r = await call(gradLink, createGraduateToken(g, "profile"), null, "/u/", "1.2.3.4");
    expect(r.status).toBe(400);
    expect(await prisma.rateLimitBucket.count({ where: { key: { contains: "unknown" } } })).toBe(0);
  });

  it("graduate links: plain rate limit of 60 requests per 15 minutes per IP", async () => {
    const g = await makeGraduate((await makeCohort()).id);
    const good = createGraduateToken(g, "profile");
    for (let i = 0; i < 60; i++) await call(gradLink, good, "3.3.3.3");
    expect((await call(gradLink, good, "3.3.3.3")).status).toBe(429);
  });

  it("partner portal links: 10 bad tokens lock the IP out", async () => {
    const company = await prisma.company.create({ data: { canonicalName: "P Co", isPartner: true } });
    const contact = await prisma.partnerContact.create({ data: { companyId: company.id, name: "Pat", emailEnc: encrypt("pat@p.test"), emailHash: blindIndex("pat@p.test") } });
    const good = partnerLink(contact).split("/p/")[1]!;
    expect((await call(partnerLinkRoute, good, "4.4.4.4", "/p/")).headers.get("location")).toMatch(/\/partner$/);
    for (let i = 0; i < 10; i++) await call(partnerLinkRoute, `bad${i}`, "4.4.4.4", "/p/");
    expect((await call(partnerLinkRoute, good, "4.4.4.4", "/p/")).status).toBe(429);
  });

  describe("6-digit codes", () => {
    const code = () => /\b(\d{6})\b/.exec(fake.sent.at(-1)!.text)![1]!;
    const wrong = (c: string) => (c === "000000" ? "111111" : "000000");

    it("each code allows 5 tries; 10 wrong codes in an hour lock ALL codes for that graduate", async () => {
      const g = await makeGraduate((await makeCohort()).id, { email: "lock@example.test" });
      const ctx = { actor: { type: "graduate" as const, id: g.id } };
      // 5 wrong guesses on an email-change code → that code is dead even with the right digits.
      await requestOtp(ctx, "change_email");
      const c1 = code();
      for (let i = 0; i < 5; i++) await expect(changeEmail(ctx, { code: wrong(c1), newEmail: "x@example.test" })).rejects.toBeInstanceOf(ValidationError);
      await expect(changeEmail(ctx, { code: c1, newEmail: "x@example.test" })).rejects.toBeInstanceOf(ValidationError);
      // 4 more failures on export and delete codes bring the hour's total to 10…
      await requestOtp(ctx, "export_data");
      for (let i = 0; i < 2; i++) await expect(exportMyData(ctx, "000001")).rejects.toBeInstanceOf(ValidationError);
      await requestOtp(ctx, "delete_account");
      const del = code();
      for (let i = 0; i < 2; i++) await expect(deleteMyAccount(ctx, wrong(del))).rejects.toBeInstanceOf(ValidationError);
      // …so now even a correct, fresh code is refused with a lockout.
      await expect(deleteMyAccount(ctx, del)).rejects.toBeInstanceOf(RateLimitError);
      expect((await prisma.graduate.findUniqueOrThrow({ where: { id: g.id } })).anonymizedAt).toBeNull();
    });

    it("requesting codes is rate-limited (3 per 15 minutes)", async () => {
      const g = await makeGraduate((await makeCohort()).id);
      const ctx = { actor: { type: "graduate" as const, id: g.id } };
      for (let i = 0; i < 3; i++) await requestOtp(ctx, "export_data");
      await expect(requestOtp(ctx, "export_data")).rejects.toBeInstanceOf(RateLimitError);
    });
  });
});

describe("AUDIT 22: lockout limits are admin-configurable, validated and audited", () => {
  beforeEach(resetDb);

  it("rejects unsafe values, audits changes, and the lockout uses the configured limit", async () => {
    const { updateSettings } = await import("@/server/services/settings-admin");
    const { staff } = await import("./helpers");
    const admin = await staff("ADMIN");
    const base = { gradLink: { limit: 10, windowMinutes: 15 }, partnerLink: { limit: 10, windowMinutes: 15 }, otp: { limit: 10, windowMinutes: 60 } };
    await expect(updateSettings(admin, "security", { ...base, gradLink: { limit: 2, windowMinutes: 15 } })).rejects.toThrow(); // below minimum
    await expect(updateSettings(admin, "security", { ...base, otp: { limit: 10, windowMinutes: 5 } })).rejects.toThrow(); // window too short
    await expect(updateSettings(admin, "security", { ...base, extra: 1 })).rejects.toThrow(); // strict
    await expect(updateSettings(await staff("CAREER_SERVICES"), "security", base)).rejects.toThrow(/permission/);

    await updateSettings(admin, "security", { ...base, gradLink: { limit: 20, windowMinutes: 15 } });
    expect(await prisma.auditLog.count({ where: { action: "settings.update", entityId: "security" } })).toBe(1);

    const g = await makeGraduate((await makeCohort()).id);
    const good = createGraduateToken(g, "profile");
    for (let i = 0; i < 15; i++) await call(gradLink, `bad${i}`, "6.6.6.6");
    expect((await call(gradLink, good, "6.6.6.6")).status).toBe(303); // 15 < 20: not locked yet
    for (let i = 15; i < 20; i++) await call(gradLink, `bad${i}`, "6.6.6.6");
    expect((await call(gradLink, good, "6.6.6.6")).status).toBe(429);
  });
});
