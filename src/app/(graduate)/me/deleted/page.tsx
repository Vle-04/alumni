import { t } from "@/i18n";
export default function Deleted() {
  return (
    <div className="py-8 text-center" role="status">
      <h1 className="text-2xl font-semibold">{t("grad.deletedTitle")}</h1>
      <p className="mt-2 text-muted">{t("grad.deletedBody")}</p>
    </div>
  );
}
