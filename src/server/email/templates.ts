/**
 * Email templates. Rendered at SEND time so every email carries a fresh 30-day link.
 * Strings come from the i18n catalog.
 */
import { t } from "@/i18n";
import { renderEmail, escapeHtml } from "./layout";

export type TemplateName = "survey_initial" | "survey_reminder" | "profile_link" | "otp" | "match_notification";

export interface TemplateContext {
  firstName: string;
  link?: string;
  unsubscribeUrl?: string;
  milestone?: number;
  code?: string;
  openingTitle?: string;
  companyName?: string;
  explanation?: string;
}

export function renderTemplate(name: TemplateName, c: TemplateContext): { subject: string; html: string; text: string } {
  const privacy = `<a href="${escapeHtml(`${process.env.APP_URL ?? ""}/privacy`)}">${escapeHtml(t("grad.privacyLink"))}</a>`;
  const footer = c.unsubscribeUrl
    ? `${escapeHtml(t("email.footer"))} ${privacy} · <a href="${escapeHtml(c.unsubscribeUrl)}">${escapeHtml(t("email.unsubscribe"))}</a>`
    : `${escapeHtml(t("email.footer"))} ${privacy}`;
  const months = String(c.milestone ?? "");
  switch (name) {
    case "survey_initial": {
      const subject = t("email.surveySubject", { months });
      return { subject, ...renderEmail({ title: t("email.surveyTitle", { name: c.firstName }), paragraphs: [t("email.surveyBody", { months }), t("email.surveyPrivacy")], cta: { label: t("email.surveyCta"), url: c.link! }, footer }) };
    }
    case "survey_reminder": {
      const subject = t("email.reminderSubject");
      return { subject, ...renderEmail({ title: t("email.surveyTitle", { name: c.firstName }), paragraphs: [t("email.reminderBody")], cta: { label: t("email.surveyCta"), url: c.link! }, footer }) };
    }
    case "profile_link": {
      const subject = t("email.linkSubject");
      return { subject, ...renderEmail({ title: t("email.surveyTitle", { name: c.firstName }), paragraphs: [t("email.linkBody")], cta: { label: t("email.linkCta"), url: c.link! }, footer: escapeHtml(t("email.linkIgnore")) }) };
    }
    case "otp": {
      const subject = t("email.otpSubject");
      return { subject, ...renderEmail({ title: t("email.otpTitle"), paragraphs: [t("email.otpBody", { code: c.code! }), t("email.otpIgnore")] }) };
    }
    case "match_notification": {
      const subject = t("email.matchSubject", { title: c.openingTitle ?? "" });
      return {
        subject,
        ...renderEmail({
          title: t("email.surveyTitle", { name: c.firstName }),
          paragraphs: [t("email.matchBody", { title: c.openingTitle ?? "", company: c.companyName ?? "" }), c.explanation ?? "", t("email.matchPrivacy")].filter(Boolean),
          cta: { label: t("email.matchCta"), url: c.link! },
          footer,
        }),
      };
    }
  }
}
