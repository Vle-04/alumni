import { requireStaffPage } from "@/server/session";
import { can } from "@/domain/rbac/permissions";
import { t } from "@/i18n";
import { signOut } from "@/server/auth";
import { Nav, type NavItem } from "./Nav";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaffPage();
  const role = ctx.actor.role;
  const items: NavItem[] = [
    { href: "/dashboard", label: t("nav.dashboard"), show: can(role, "dashboard:read") },
    { href: "/graduates", label: t("nav.graduates"), show: can(role, "graduate:read") },
    { href: "/cohorts", label: t("nav.cohorts"), show: can(role, "cohort:write") },
    { href: "/openings", label: t("nav.openings"), show: can(role, "opening:read") },
    { href: "/referrals", label: t("nav.referrals"), show: can(role, "referral:read") },
    { href: "/import", label: t("nav.import"), show: can(role, "graduate:import") },
    { href: "/companies", label: t("nav.companies"), show: can(role, "company:read") },
    { href: "/surveys", label: t("nav.surveys"), show: can(role, "survey:read") },
    { href: "/reports", label: t("nav.reports"), show: can(role, "report:read") },
    { href: "/admin/users", label: t("nav.users"), show: can(role, "user:manage") },
    { href: "/admin/skills", label: t("nav.skills"), show: can(role, "skills:manage") },
    { href: "/admin/settings", label: t("nav.settings"), show: can(role, "settings:manage") },
  ].filter((i) => i.show);

  async function doSignOut(formData?: FormData) {
    "use server";
    parseArgs(z.tuple([A.form.optional()]), [formData]);
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-dvh lg:flex">
      <header className="border-b border-border bg-surface lg:min-h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 lg:block">
          <p className="font-semibold">{t("app.name")}</p>
          <p className="text-xs text-muted lg:mt-1">{ctx.userName ?? ctx.userEmail} · {role.replace("_", " ").toLowerCase()}</p>
        </div>
        <Nav items={items} />
        <form action={doSignOut} className="px-4 pb-4">
          <button className="text-sm text-muted underline" type="submit">{t("nav.signOut")}</button>
        </form>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
