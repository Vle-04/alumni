import { t } from "@/i18n";

/** Graduate-facing pages: mobile-first, no staff chrome, minimal JavaScript. */
export default function GraduateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <p className="mx-auto max-w-xl px-4 py-3 text-sm font-semibold">{t("app.name").replace("Alumni Tracker", "Academy Careers")}</p>
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-6">{children}</main>
    </div>
  );
}
