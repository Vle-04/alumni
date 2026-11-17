import type { Metadata } from "next";
import Link from "next/link";
import { confirmPrompt } from "@/domain/surveys/form";
import { enumLabel, t } from "@/i18n";
import { requireGraduatePage } from "@/server/graduate-session";
import { getSelfServiceView } from "@/server/services/self-service";
import { listMatchesForGraduate } from "@/server/services/placement";
import { Card, Button } from "@/components/ui";
import { SurveyForm } from "./SurveyForm";
import { ChangeEmail, ConsentForm, PreferencesForm } from "./MeForms";
import { DeleteAccount, DownloadData } from "./YourData";
import { setSubscriptionAction, submitSelfUpdateAction } from "./actions";

export const metadata: Metadata = { title: "My career update" };

export default async function MePage() {
  const ctx = await requireGraduatePage();
  const [v, matches] = await Promise.all([getSelfServiceView(ctx), listMatchesForGraduate(ctx)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("grad.hello", { name: v.firstName })}</h1>
        <p className="mt-1 text-muted">{t("grad.intro")}</p>
      </div>

      {v.openSurveys.map((s) => (
        <Link key={s.id} href={`/me/survey/${s.id}`} className="block rounded-lg border border-accent bg-accent/10 p-3 font-medium text-accent">
          {t("grad.surveyTitle", { months: s.milestone })} →
        </Link>
      ))}

      {matches.length > 0 && (
        <Card title={t("match.yourMatches")}>
          <ul className="divide-y divide-border">{matches.map((m) => (
            <li key={m.id}><Link href={`/me/matches/${m.id}`} className="flex min-h-11 items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{m.opening.title}</span> <span className="text-sm text-muted">· {m.opening.company.canonicalName}</span></span>
              <span className="text-sm text-muted">{m.response === "interested" ? "Interested" : m.response === "not_interested" ? "Not interested" : "→"}</span>
            </Link></li>
          ))}</ul>
        </Card>
      )}

      <Card title={t("grad.currentStatus")}>
        <p className="mb-4">{v.last ? <>{enumLabel("status", v.last.status)}{v.last.companyName && <> · {v.last.companyName}</>}{v.last.roleTitle && <> · {v.last.roleTitle}</>}</> : t("grad.nothingYet")}</p>
        <SurveyForm action={submitSelfUpdateAction} prompt={confirmPrompt(v.last)} last={v.last} />
      </Card>

      <Card title={t("grad.preferencesTitle")}><PreferencesForm prefs={v.prefs} /></Card>
      <Card title={t("grad.consentTitle")}><ConsentForm granted={v.consents} /></Card>

      <Card title={t("grad.emailTitle")}>
        <p className="mb-3 text-sm">{t("grad.emailOnFile", { email: v.maskedEmail ?? "—" })}</p>
        <ChangeEmail />
        <div className="mt-4 border-t border-border pt-4 text-sm">
          {v.unsubscribed ? (
            <form action={setSubscriptionAction.bind(null, true)}><p className="mb-2">{t("grad.emailsPaused")}</p><Button type="submit" variant="secondary">{t("grad.resubscribe")}</Button></form>
          ) : (
            <form action={setSubscriptionAction.bind(null, false)}><Button type="submit" variant="ghost" className="underline">{t("email.unsubscribe")}</Button></form>
          )}
        </div>
      </Card>

      <Card title={t("grad.yourDataTitle")}>
        <p className="mb-3 text-sm text-muted">{t("grad.yourDataHelp")}</p>
        <div className="space-y-4">
          <DownloadData />
          <DeleteAccount />
        </div>
        <p className="mt-4 text-sm"><Link className="underline" href="/privacy">{t("grad.privacyLink")}</Link></p>
      </Card>
    </div>
  );
}
