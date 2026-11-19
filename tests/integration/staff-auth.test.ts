/**
 * Staff sign-in: email + password for everyone, Google for non-admins only, no self sign-up.
 * Passwords are set through emailed one-time links (admin invite / "forgot password").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Account, Profile, User } from "next-auth";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { ForbiddenError, RateLimitError, ValidationError } from "@/server/errors";
import { hashPassword, verifyPassword } from "@/server/password";
import { authConfig } from "@/server/auth";
import { inviteUser } from "@/server/services/users";
import { BAD_CREDENTIALS, passwordTokenValid, requestPasswordReset, resetPassword, sendPasswordSetupLink, signInWithPassword } from "@/server/services/staff-auth";
import { FakeEmailAdapter } from "./fake-email";
import { resetDb, staff } from "./helpers";

const PW = "correct horse battery";
const linkToken = (fake: FakeEmailAdapter) => {
  const m = fake.sent.at(-1)!.text.match(/\/login\/reset\?token=([A-Za-z0-9_-]+)/);
  return m![1]!;
};

describe("staff email + password sign-in", () => {
  let fake: FakeEmailAdapter;
  let ipN = 0;
  const ip = () => `10.1.0.${++ipN}`;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter();
    setEmailAdapter(fake);
  });
  afterEach(() => setEmailAdapter(undefined));

  it("hashes with a per-password salt and verifies only the right password", async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword(PW + "!", a)).toBe(false);
  });

  it("invite → set-password link → sign in creates a database session", async () => {
    const admin = await staff("ADMIN");
    const id = await inviteUser(admin, { email: "New.Person@Academy.test", name: "New Person", role: "CAREER_SERVICES" });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("new.person@academy.test");
    const token = linkToken(fake);
    expect(await passwordTokenValid(token)).toBe(true);

    // Not usable before a password is set.
    expect(await signInWithPassword({ email: "new.person@academy.test", password: PW, ip: ip() })).toEqual({ ok: false, error: BAD_CREDENTIALS });

    await resetPassword(token, PW, PW);
    expect(await passwordTokenValid(token)).toBe(false);
    await expect(resetPassword(token, PW, PW)).rejects.toThrow(ValidationError); // one use only

    const r = await signInWithPassword({ email: "NEW.PERSON@academy.test", password: PW, ip: ip() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const session = await prisma.session.findUniqueOrThrow({ where: { sessionToken: r.sessionToken } });
    expect(session.userId).toBe(id);
    expect(session.expires.getTime() - Date.now()).toBeGreaterThan(7.9 * 3600_000);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).lastLoginAt).not.toBeNull();
  });

  it("gives the same answer for wrong password, unknown email and deactivated users", async () => {
    const ctx = await staff("CAREER_SERVICES");
    const u = await prisma.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: await hashPassword(PW) } });
    expect(await signInWithPassword({ email: u.email, password: "wrong password!!", ip: ip() })).toEqual({ ok: false, error: BAD_CREDENTIALS });
    expect(await signInWithPassword({ email: "nobody@academy.test", password: PW, ip: ip() })).toEqual({ ok: false, error: BAD_CREDENTIALS });
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await signInWithPassword({ email: u.email, password: PW, ip: ip() })).toEqual({ ok: false, error: BAD_CREDENTIALS });
    expect(await prisma.session.count()).toBe(0);
  });

  it("stops guessing after 10 attempts per account, even with the right password", async () => {
    const ctx = await staff("ADMIN");
    const u = await prisma.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: await hashPassword(PW) } });
    for (let i = 0; i < 10; i++) await signInWithPassword({ email: u.email, password: `guess-number-${i}`, ip: ip() });
    const r = await signInWithPassword({ email: u.email, password: PW, ip: ip() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many attempts/);
  });

  it("setting a new password signs the user out everywhere", async () => {
    const ctx = await staff("CAREER_SERVICES");
    await prisma.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: await hashPassword(PW) } });
    await prisma.session.create({ data: { sessionToken: "old-session", userId: ctx.actor.id, expires: new Date(Date.now() + 3600_000) } });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.actor.id } });
    await requestPasswordReset(u.email, ip());
    await resetPassword(linkToken(fake), "a brand new password", "a brand new password");
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    expect((await signInWithPassword({ email: u.email, password: PW, ip: ip() })).ok).toBe(false);
    expect((await signInWithPassword({ email: u.email, password: "a brand new password", ip: ip() })).ok).toBe(true);
  });

  it("validates the new password and the confirmation", async () => {
    const admin = await staff("ADMIN");
    await sendPasswordSetupLink(admin, admin.actor.id);
    const token = linkToken(fake);
    await expect(resetPassword(token, "short", "short")).rejects.toThrow(/at least 12/);
    await expect(resetPassword(token, PW, PW + "x")).rejects.toThrow(/don't match/);
    expect(await passwordTokenValid(token)).toBe(true); // failed attempts don't consume the link
  });

  it("'forgot password' never reveals whether an email is registered, and is rate limited", async () => {
    await requestPasswordReset("nobody@academy.test", ip());
    expect(fake.sent).toHaveLength(0);
    const ctx = await staff("LEADERSHIP");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.actor.id } });
    const sameIp = ip();
    for (let i = 0; i < 3; i++) await requestPasswordReset(u.email, sameIp);
    expect(fake.sent).toHaveLength(3);
    await expect(requestPasswordReset(u.email, sameIp)).rejects.toThrow(RateLimitError);
  });

  it("only admins can send password links", async () => {
    const careers = await staff("CAREER_SERVICES");
    const other = await staff("LEADERSHIP");
    await expect(sendPasswordSetupLink(careers, other.actor.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("Google / OAuth sign-in rules (Auth.js signIn callback)", () => {
  beforeEach(resetDb);
  const signIn = (email: string, verified: boolean | undefined, provider = "google") =>
    authConfig.callbacks!.signIn!({
      user: { email } as User,
      account: { provider, type: "oidc", providerAccountId: "x" } as Account,
      profile: { email, email_verified: verified } as Profile,
    });

  it("lets existing non-admin staff in with a verified Google email", async () => {
    const ctx = await staff("CAREER_SERVICES");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.actor.id } });
    expect(await signIn(u.email, true)).toBe(true);
    expect(await signIn(u.email.toUpperCase(), true)).toBe(true);
  });

  it("refuses admins (password only), unverified emails, unknown emails and deactivated users", async () => {
    const admin = await staff("ADMIN");
    const a = await prisma.user.findUniqueOrThrow({ where: { id: admin.actor.id } });
    expect(await signIn(a.email, true)).toBe("/login?error=AdminPasswordOnly");
    expect(await signIn(a.email, true, "oidc")).toBe("/login?error=AdminPasswordOnly");

    const ctx = await staff("LEADERSHIP");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.actor.id } });
    expect(await signIn(u.email, false)).toBe(false);
    expect(await signIn(u.email, undefined)).toBe(false);
    expect(await signIn("stranger@gmail.com", true)).toBe(false); // no self sign-up
    expect(await prisma.user.count({ where: { email: "stranger@gmail.com" } })).toBe(0);
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await signIn(u.email, true)).toBe(false);
  });
});
