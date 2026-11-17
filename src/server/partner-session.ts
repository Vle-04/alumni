import { cookies, headers } from "next/headers";
import { PARTNER_SESSION_COOKIE, resolvePartner } from "./services/partner";
import type { RequestContext } from "./context";

export async function getPartnerContext(): Promise<(RequestContext & { actor: { type: "partner"; id: string; companyId: string }; companyName: string; contactName: string }) | null> {
  const v = (await cookies()).get(PARTNER_SESSION_COOKIE)?.value;
  if (!v) return null;
  const r = await resolvePartner(v, "session");
  if (!r.ok) return null;
  const h = await headers();
  return {
    actor: { type: "partner", id: r.contact.id, companyId: r.contact.companyId },
    companyName: r.contact.company.canonicalName,
    contactName: r.contact.name,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}
