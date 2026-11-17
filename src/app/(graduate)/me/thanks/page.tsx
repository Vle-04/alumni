import Link from "next/link";
import { t } from "@/i18n";
import { requireGraduatePage } from "@/server/graduate-session";

export default async function Thanks() {
  await requireGraduatePage();
  return (
    <div className="py-8 text-center" role="status">
      <h1 className="text-2xl font-semibold">{t("grad.thanksTitle")}</h1>
      <p className="mt-2 text-muted">{t("grad.thanksBody")}</p>
      <Link href="/me" className="mt-6 inline-block underline">{t("grad.backToMyPage")}</Link>
    </div>
  );
}
