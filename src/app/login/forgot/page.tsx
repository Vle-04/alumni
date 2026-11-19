import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./ForgotForm";

export const metadata: Metadata = { title: "Reset password" };
// Render per request: the CSP nonce (src/middleware.ts) only reaches dynamically rendered pages.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 mb-6 text-sm text-muted">Enter your work email and we&apos;ll send you a link to choose a new password.</p>
      <ForgotForm />
      <p className="mt-6 text-sm"><Link href="/login" className="underline underline-offset-2">Back to sign in</Link></p>
    </main>
  );
}
