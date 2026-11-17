import { z } from "zod";
import { ROLES } from "@/domain/rbac/permissions";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";

export const userInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
});

export async function listUsers(ctx: RequestContext) {
  requirePermission(ctx, "user:manage");
  return prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true } });
}

/** Invites a staff member. They can then sign in with a magic link or SSO. */
export async function inviteUser(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "user:manage");
  const input = userInputSchema.parse(raw);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw new ConflictError("A staff user with this email already exists.");
  const u = await prisma.user.create({ data: input });
  await audit(prisma, ctx, { action: "user.invite", entityType: "User", entityId: u.id, after: { role: u.role, name: u.name } });
  return u.id;
}

export async function updateUser(ctx: RequestContext, id: string, raw: unknown) {
  requirePermission(ctx, "user:manage");
  const input = z.object({ role: z.enum(ROLES), active: z.boolean() }).parse(raw);
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("User");
  if (before.role === "ADMIN" && (input.role !== "ADMIN" || !input.active)) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) throw new ValidationError("There must be at least one active administrator.");
  }
  const after = await prisma.user.update({ where: { id }, data: input });
  if (!input.active) await prisma.session.deleteMany({ where: { userId: id } }); // sign out everywhere
  await audit(prisma, ctx, { action: "user.update", entityType: "User", entityId: id, before: { role: before.role, active: before.active }, after: { role: after.role, active: after.active } });
}
