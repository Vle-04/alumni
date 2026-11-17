import { t } from "@/i18n";
export default function CheckEmail() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">{t("auth.checkEmailTitle")}</h1>
      <p className="mt-3 text-muted">{t("auth.checkEmailBody")}</p>
    </main>
  );
}
