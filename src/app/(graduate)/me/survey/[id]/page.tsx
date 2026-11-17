import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmPrompt } from "@/domain/surveys/form";
import { t } from "@/i18n";
import { requireGraduatePage } from "@/server/graduate-session";
import { getSurveyForGraduate } from "@/server/services/self-service";
import { NotFoundError } from "@/server/errors";
import { Alert } from "@/components/ui";
import { SurveyForm } from "../../SurveyForm";
import { submitSelfUpdateAction, submitSurveyAction } from "../../actions";

export const metadata: Metadata = { title: "Check-in" };

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGraduatePage();
  const { id } = await params;
  const survey = await getSurveyForGraduate(ctx, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!survey) notFound();
  return (
    <>
      <h1 className="text-2xl font-semibold">{survey.catchUp ? t("grad.catchUpTitle") : t("grad.surveyTitle", { months: survey.milestone })}</h1>
      <p className="mt-1 mb-5 text-muted">{t("grad.intro")}</p>
      {!survey.open && <div className="mb-4"><Alert>{t("grad.surveyClosed")}</Alert></div>}
      <SurveyForm action={survey.open ? submitSurveyAction.bind(null, survey.id) : submitSelfUpdateAction} prompt={confirmPrompt(survey.last)} last={survey.last} />
      <p className="mt-6 text-center text-sm"><Link className="underline" href="/me">{t("grad.backToMyPage")}</Link></p>
    </>
  );
}
