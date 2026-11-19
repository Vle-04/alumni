"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { signIn, STAFF_SESSION_COOKIE } from "@/server/auth";
import { requestClientIp } from "@/server/rate-limit";
import { RateLimitError, ValidationError } from "@/server/errors";
import { BAD_CREDENTIALS, requestPasswordReset, resetPassword, signInWithPassword } from "@/server/services/staff-auth";

type FormState = { error?: string; fieldErrors?: Record<string, string[]>; sent?: boolean };
const NO_IP = "We couldn't verify your network address. Please try again.";

export async function signInWithPasswordAction(...args: [_prev: FormState, fd: FormData]): Promise<FormState> {
  const [_prev, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const email = z.string().trim().toLowerCase().pipe(z.email()).safeParse(fd.get("email"));
  const password = z.string().min(1).max(256).safeParse(fd.get("password"));
  if (!email.success || !password.success) {
    return { error: "Enter your email and password.", fieldErrors: { ...(!email.success ? { email: ["Enter a valid email address."] } : {}), ...(!password.success ? { password: ["Enter your password."] } : {}) } };
  }
  const ip = await requestClientIp();
  if (!ip) return { error: NO_IP };
  const r = await signInWithPassword({ email: email.data, password: password.data, ip, userAgent: (await headers()).get("user-agent") });
  if (!r.ok) return { error: r.error === BAD_CREDENTIALS ? BAD_CREDENTIALS : r.error };
  (await cookies()).set(STAFF_SESSION_COOKIE, r.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: STAFF_SESSION_COOKIE.startsWith("__Secure-"),
    expires: r.expires,
  });
  redirect("/"); // main page: dashboard (or reports for Leadership)
}

export async function signInGoogle(...args: [_formData?: FormData]) {
  parseArgs(z.tuple([A.form.optional()]), args);
  await signIn("google", { redirectTo: "/" });
}

export async function signInSso(...args: [_formData?: FormData]) {
  parseArgs(z.tuple([A.form.optional()]), args);
  await signIn("oidc", { redirectTo: "/" });
}

export async function requestPasswordResetAction(...args: [_prev: FormState, fd: FormData]): Promise<FormState> {
  const [_prev, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const email = z.string().trim().toLowerCase().pipe(z.email()).safeParse(fd.get("email"));
  if (!email.success) return { error: "Enter a valid email address.", fieldErrors: { email: ["Enter a valid email address."] } };
  const ip = await requestClientIp();
  if (!ip) return { error: NO_IP };
  try {
    await requestPasswordReset(email.data, ip);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: "Too many requests. Please wait 15 minutes and try again." };
    throw err;
  }
  return { sent: true };
}

export async function resetPasswordAction(...args: [_prev: FormState, fd: FormData]): Promise<FormState> {
  const [_prev, fd] = parseArgs(z.tuple([A.prev, A.form]), args);
  const str = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  try {
    await resetPassword(str("token"), str("password"), str("confirm"));
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message, fieldErrors: err.fieldErrors };
    throw err;
  }
  redirect("/login?reset=1");
}
