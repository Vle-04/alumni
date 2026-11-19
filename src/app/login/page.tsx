import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { Alert, Button } from "@/components/ui";
import { getStaffContext } from "@/server/session";
import { googleEnabled, ssoEnabled } from "@/server/auth";
import { LoginForm } from "./LoginForm";
import { signInGoogle, signInSso } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AdminPasswordOnly: "Administrators must sign in with email and password.",
  AccessDenied: "This account can't sign in here. Ask an administrator to add you as a staff member.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if (await getStaffContext()) redirect("/");
  const { error, reset } = await searchParams;
  const google = googleEnabled();
  const sso = ssoEnabled();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("auth.signInTitle")}</h1>
      <p className="mt-2 mb-6 text-sm text-muted">{t("auth.signInHelp")}</p>
      {reset && <div className="mb-4"><Alert tone="success">Your password is set. Sign in with it now.</Alert></div>}
      {error && <div className="mb-4"><Alert tone="danger">{ERRORS[error] ?? t("auth.error")}</Alert></div>}
      <LoginForm />
      {(google || sso) && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-current opacity-30" />or<span className="h-px flex-1 bg-current opacity-30" />
          </div>
          <div className="space-y-3">
            {google && (
              <form action={signInGoogle}>
                <Button variant="secondary" className="w-full" type="submit">Continue with Google</Button>
              </form>
            )}
            {sso && (
              <form action={signInSso}>
                <Button variant="secondary" className="w-full" type="submit">{t("auth.sso")}</Button>
              </form>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">Administrators sign in with email and password only.</p>
        </>
      )}
    </main>
  );
}
