import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { resolveGraduateToken } from "@/server/tokens";
import { unsubscribeByToken } from "@/server/services/self-service";
import { Alert, Button } from "@/components/ui";
import { A, parseArgs } from "@/lib/action-args";
import { z } from "zod";

/** GET only shows a confirmation (link scanners must not unsubscribe people); POST acts. */
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  if ((await searchParams).done) return <Alert tone="success">{t("unsub.done")}</Alert>;
  async function confirm(...args: [_formData?: FormData]) {
    "use server";
    parseArgs(z.tuple([A.form.optional()]), args);
    const r = await resolveGraduateToken(token, ["unsubscribe"]);
    if (r.ok) await unsubscribeByToken(r.graduateId);
    redirect(`/unsubscribe/${token}?done=1`);
  }
  return (
    <form action={confirm} className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("unsub.title")}</h1>
      <p className="text-muted">{t("unsub.body")}</p>
      <Button type="submit">{t("unsub.confirm")}</Button>
    </form>
  );
}
