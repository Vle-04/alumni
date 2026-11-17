import type { Metadata } from "next";
import { t, type MessageKey } from "@/i18n";
import { RequestLinkForm } from "./RequestLinkForm";

export const metadata: Metadata = { title: "Request a new link" };

const TITLES: Record<string, MessageKey> = { expired: "link.expiredTitle", revoked: "link.revokedTitle", invalid: "link.invalidTitle", session: "link.sessionTitle" };

export default async function LinkExpired({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">{t(TITLES[r ?? ""] ?? "link.invalidTitle")}</h1>
      <p className="mt-2 mb-5 text-muted">{t("link.body")}</p>
      <RequestLinkForm />
    </>
  );
}
