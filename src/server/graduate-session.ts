import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GRAD_SESSION_COOKIE, resolveGraduateToken } from "./tokens";
import { headers } from "next/headers";
import type { RequestContext } from "./context";
import { clientIp } from "./client-ip";

/** The signed-in graduate (via personal link), or null. Re-checks token version on every request. */
export async function getGraduateContext(): Promise<(RequestContext & { actor: { type: "graduate"; id: string } }) | null> {
  const value = (await cookies()).get(GRAD_SESSION_COOKIE)?.value;
  if (!value) return null;
  const r = await resolveGraduateToken(value, ["session"]);
  if (!r.ok) return null;
  const h = await headers();
  return { actor: { type: "graduate", id: r.graduateId }, ip: clientIp(h), userAgent: h.get("user-agent") };
}

export async function requireGraduatePage() {
  const ctx = await getGraduateContext();
  if (!ctx) redirect("/link-expired?r=session");
  return ctx;
}
