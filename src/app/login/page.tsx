import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { Alert, Button } from "@/components/ui";
import { getStaffContext } from "@/server/session";
import { LoginForm } from "./LoginForm";
import { signInSso } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getStaffContext()) redirect("/");
  const { error } = await searchParams;
  const sso = Boolean(process.env.AUTH_OIDC_ISSUER && process.env.AUTH_OIDC_CLIENT_ID);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("auth.signInTitle")}</h1>
      <p className="mt-2 mb-6 text-sm text-muted">{t("auth.signInHelp")}</p>
      {error && <div className="mb-4"><Alert tone="danger">{t("auth.error")}</Alert></div>}
      <LoginForm labels={{ email: t("auth.emailLabel"), send: t("auth.sendLink") }} />
      {sso && (
        <form action={signInSso} className="mt-4">
          <Button variant="secondary" className="w-full" type="submit">{t("auth.sso")}</Button>
        </form>
      )}
    </main>
  );
}
