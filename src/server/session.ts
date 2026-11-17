/**
 * Bridges Next.js request state (Auth.js session, headers) to a RequestContext.
 * Pages use requireStaffPage(); server actions use staffActionContext().
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission, type Role } from "@/domain/rbac/permissions";
import { auth } from "./auth";
import { prisma } from "./db";
import { UnauthenticatedError, ForbiddenError } from "./errors";
import type { RequestContext } from "./context";
import { clientIp } from "./client-ip";

export type StaffContext = RequestContext & { actor: { type: "user"; id: string; role: Role }; userName: string | null; userEmail: string };

async function requestMeta() {
  const h = await headers();
  const ip = clientIp(h);
  return { ip, userAgent: h.get("user-agent") };
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  // Re-read role/active on every request so demotions and deactivations take effect immediately.
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, active: true, name: true, email: true } });
  if (!user?.active) return null;
  return { actor: { type: "user", id: user.id, role: user.role }, userName: user.name, userEmail: user.email, ...(await requestMeta()) };
}

export async function requireStaffPage(permission?: Permission): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (permission && !can(ctx.actor.role, permission)) redirect("/forbidden");
  return ctx;
}

export async function staffActionContext(permission?: Permission): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) throw new UnauthenticatedError();
  if (permission && !can(ctx.actor.role, permission)) throw new ForbiddenError();
  return ctx;
}
