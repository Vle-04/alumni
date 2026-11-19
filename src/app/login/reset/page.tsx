import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { passwordTokenValid } from "@/server/services/staff-auth";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Set password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const valid = await passwordTokenValid(token);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">Choose a password</h1>
      {valid ? (
        <>
          <p className="mt-2 mb-6 text-sm text-muted">After saving, you&apos;ll be signed out everywhere and can sign in with the new password.</p>
          <ResetForm token={token} />
        </>
      ) : (
        <div className="mt-6"><Alert tone="danger">This link is invalid or has expired. <Link href="/login/forgot" className="underline">Request a new one</Link>.</Alert></div>
      )}
    </main>
  );
}
