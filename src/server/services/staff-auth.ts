/**
 * Staff email + password sign-in, and emailed links to set or reset a password.
 * There is no self sign-up: accounts are created by an admin (Admin → Staff users).
 *
 * Sessions are ordinary Auth.js database sessions (same table and cookie Auth.js uses), so
 * `auth()`, sign-out, deactivation and the 8-hour lifetime behave exactly as for Google sign-in.
 */
import { randomBytes } from "node:crypto";
import type { Role } from "@/domain/rbac/permissions";
import { prisma } from "../db";
import { audit } from "../audit";
import { hashSecret } from "../crypto";
import { env } from "../env";
import { emailAdapter } from "../email/adapters";
import { renderEmail } from "../email/layout";
import { logger } from "../logger";
import { checkRateLimit } from "../rate-limit";
import { requirePermission, type RequestContext } from "../context";
import { NotFoundError, RateLimitError, ValidationError } from "../errors";
import { hashPassword, passwordSchema, verifyAgainstDummy, verifyPassword } from "../password";

export const STAFF_SESSION_MAX_AGE_S = 8 * 60 * 60;
const RESET_TTL_MS = 60 * 60 * 1000; // "forgot password"
const SETUP_TTL_MS = 72 * 60 * 60 * 1000; // first password after an invite
const resetId = (userId: string) => `pwreset:${userId}`;

export const BAD_CREDENTIALS = "Email or password is incorrect.";

export type PasswordSignIn = { ok: true; sessionToken: string; expires: Date; role: Role } | { ok: false; error: string };

export async function signInWithPassword(input: { email: string; password: string; ip: string; userAgent?: string | null }, now = new Date()): Promise<PasswordSignIn> {
  const email = input.email.trim().toLowerCase();
  const allowed = (await checkRateLimit(`staff-pw:ip:${input.ip}`, 20, 15 * 60)) && (await checkRateLimit(`staff-pw:email:${email}`, 10, 15 * 60));
  if (!allowed) return { ok: false, error: "Too many attempts. Please wait 15 minutes and try again." };

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, active: true, passwordHash: true } });
  const valid = user?.active && user.passwordHash ? await verifyPassword(input.password, user.passwordHash) : await verifyAgainstDummy(input.password);
  if (!user || !valid) {
    logger.info("staff password sign-in failed");
    return { ok: false, error: BAD_CREDENTIALS };
  }

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(now.getTime() + STAFF_SESSION_MAX_AGE_S * 1000);
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  await audit(prisma, { actor: { type: "user", id: user.id, role: user.role }, ip: input.ip, userAgent: input.userAgent ?? null }, { action: "auth.sign_in", entityType: "User", entityId: user.id, meta: { method: "password" } });
  return { ok: true, sessionToken, expires, role: user.role };
}

async function sendPasswordLink(user: { id: string; email: string }, kind: "setup" | "reset", now = new Date()) {
  const raw = randomBytes(32).toString("base64url");
  const ttl = kind === "setup" ? SETUP_TTL_MS : RESET_TTL_MS;
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: resetId(user.id) } }),
    prisma.verificationToken.create({ data: { identifier: resetId(user.id), token: hashSecret(raw), expires: new Date(now.getTime() + ttl) } }),
  ]);
  const url = `${env().APP_URL.replace(/\/$/, "")}/login/reset?token=${raw}`;
  const subject = kind === "setup" ? "Set your Alumni Tracker password" : "Reset your Alumni Tracker password";
  const body = kind === "setup"
    ? "An administrator created a staff account for you. Choose a password to sign in. This link expires in 72 hours and works once."
    : "Someone (hopefully you) asked to reset your password. This link expires in 1 hour and works once. If it wasn't you, ignore this email.";
  const { html, text } = renderEmail({ title: subject, paragraphs: [body], cta: { label: kind === "setup" ? "Set password" : "Reset password", url } });
  await emailAdapter().send({ to: user.email, subject, html, text });
}

/** "Forgot password". Never reveals whether the address has an account. */
export async function requestPasswordReset(rawEmail: string, ip: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const allowed = (await checkRateLimit(`staff-reset:ip:${ip}`, 10, 15 * 60)) && (await checkRateLimit(`staff-reset:email:${email}`, 3, 15 * 60));
  if (!allowed) throw new RateLimitError(15 * 60);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, active: true } });
  if (!user?.active) {
    logger.info("password reset requested for non-staff address; not sent");
    return;
  }
  await sendPasswordLink(user, "reset");
}

/** Admin: email a staff member a link to set (or replace) their password. */
export async function sendPasswordSetupLink(ctx: RequestContext, userId: string): Promise<void> {
  requirePermission(ctx, "user:manage");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, active: true } });
  if (!user) throw new NotFoundError("User");
  if (!user.active) throw new ValidationError("Activate this user before sending a password link.");
  await sendPasswordLink(user, "setup");
  await audit(prisma, ctx, { action: "user.password_link_sent", entityType: "User", entityId: user.id });
}

/** Whether a set/reset link is still usable (for showing the form vs. an "expired" message). */
export async function passwordTokenValid(raw: string, now = new Date()): Promise<boolean> {
  if (!raw) return false;
  const row = await prisma.verificationToken.findFirst({ where: { token: hashSecret(raw), identifier: { startsWith: "pwreset:" }, expires: { gt: now } } });
  return Boolean(row);
}

/** Sets the password from an emailed link, then signs the user out everywhere. */
export async function resetPassword(raw: string, password: string, confirm: string, now = new Date()): Promise<void> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message, { password: [parsed.error.issues[0]!.message] });
  if (password !== confirm) throw new ValidationError("The passwords don't match.", { confirm: ["The passwords don't match."] });
  const row = raw ? await prisma.verificationToken.findFirst({ where: { token: hashSecret(raw), identifier: { startsWith: "pwreset:" }, expires: { gt: now } } }) : null;
  if (!row) throw new ValidationError("This link is invalid or has expired. Request a new one.");
  const userId = row.identifier.slice("pwreset:".length);
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    // Consume first: if two requests race with the same link, only one deletes the row.
    const consumed = await tx.verificationToken.deleteMany({ where: { identifier: row.identifier, token: row.token } });
    if (consumed.count !== 1) throw new ValidationError("This link is invalid or has expired. Request a new one.");
    await tx.session.deleteMany({ where: { userId } });
    return tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: now }, select: { id: true, role: true } });
  });
  await audit(prisma, { actor: { type: "user", id: user.id, role: user.role } }, { action: "auth.password_set", entityType: "User", entityId: user.id });
}
