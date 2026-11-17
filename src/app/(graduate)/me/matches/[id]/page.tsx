import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { enumLabel, t } from "@/i18n";
import { requireGraduatePage } from "@/server/graduate-session";
import { getMatchForGraduate } from "@/server/services/placement";
import { NotFoundError } from "@/server/errors";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { respondToMatchAction } from "../../actions";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";

export const metadata: Metadata = { title: "Opening" };

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGraduatePage();
  const { id } = await params;
  const m = await getMatchForGraduate(ctx, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!m) notFound();
  const o = m.opening;
  async function interested(...args: [_formData?: FormData]) {
    "use server";
    parseArgs(z.tuple([A.form.optional()]), args);
    await respondToMatchAction(id, "interested");
  }
  async function notInterested(...args: [_formData?: FormData]) {
    "use server";
    parseArgs(z.tuple([A.form.optional()]), args);
    await respondToMatchAction(id, "not_interested");
  }
  return (
    <div className="space-y-5">
      <p className="text-sm font-medium text-accent">{t("match.title")}</p>
      <div>
        <h1 className="text-2xl font-semibold">{o.title}</h1>
        <p className="text-muted">{t("match.at", { company: o.companyName })}{o.industry && ` · ${o.industry}`}</p>
      </div>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Where</dt><dd>{enumLabel("remoteMode", o.remoteMode)}{o.city && ` · ${o.city}`}{o.country && `, ${o.country}`}</dd>
          <dt className="text-muted">Level</dt><dd className="capitalize">{o.seniority}</dd>
          {o.salaryBand && <><dt className="text-muted">Salary band</dt><dd>{enumLabel("salary", o.salaryBand)} / month</dd></>}
          {o.deadline && <><dt className="text-muted">Apply by</dt><dd>{fmtDate(o.deadline)}</dd></>}
        </dl>
        <p className="mt-3 whitespace-pre-line text-sm">{o.description}</p>
        <ul className="mt-3 flex flex-wrap gap-1">{o.skills.map((s) => <li key={s.name}><Badge tone={s.mustHave ? "accent" : "neutral"}>{s.name}{s.mustHave && ` · ${t("match.mustHave")}`}</Badge></li>)}</ul>
      </Card>

      {!m.open ? <Alert>{t("match.closed")}</Alert> : (
        <>
          <Alert tone={m.shareConsent ? "neutral" : "warning"}>{m.shareConsent ? t("match.sharingOn", { company: o.companyName }) : t("match.sharingOff")}</Alert>
          {m.response === "interested" && <Alert tone="success">{t("match.youSaidInterested")}</Alert>}
          {m.response === "not_interested" && <Alert>{t("match.youSaidNo")}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            {m.response !== "interested" && <form action={interested}><Button type="submit" className="w-full py-3 text-base">{t("match.interested")}</Button></form>}
            {m.response === null && <form action={notInterested}><Button type="submit" variant="secondary" className="w-full py-3 text-base">{t("match.notInterested")}</Button></form>}
          </div>
        </>
      )}
      <p className="text-center text-sm"><Link className="underline" href="/me">{t("grad.backToMyPage")}</Link></p>
    </div>
  );
}
