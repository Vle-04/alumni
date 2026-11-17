import Link from "next/link";
import { t } from "@/i18n";
export default function Forbidden() {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-semibold">{t("auth.forbiddenTitle")}</h1>
      <p className="mt-3 text-muted">{t("auth.forbiddenBody")}</p>
      <Link href="/" className="mt-6 inline-block underline">Go to your home page</Link>
    </main>
  );
}
