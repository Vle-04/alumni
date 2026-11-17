"use server";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";
import { signIn } from "@/server/auth";
import { checkRateLimit, clientIp } from "@/server/rate-limit";

export async function requestStaffLink(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  parseArgs(z.tuple([A.prev, A.form]), [_prev, fd]);
  const email = z.string().trim().toLowerCase().pipe(z.email()).safeParse(fd.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const ip = await clientIp();
  const ok = (await checkRateLimit(`staff-login:ip:${ip}`, 10, 15 * 60)) && (await checkRateLimit(`staff-login:email:${email.data}`, 5, 15 * 60));
  if (!ok) return { error: "Too many attempts. Please wait 15 minutes and try again." };
  await signIn("email", { email: email.data, redirectTo: "/" });
  return {};
}

export async function signInSso(formData?: FormData) {
  parseArgs(z.tuple([A.form.optional()]), [formData]);
  await signIn("oidc", { redirectTo: "/" });
}
