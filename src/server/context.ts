/**
 * Who is doing something, and from where. Every service function takes a RequestContext
 * and checks permissions itself — callers (server actions, routes, jobs) cannot skip it.
 */
import { can, type Permission, type Role } from "@/domain/rbac/permissions";
import { ForbiddenError } from "./errors";

export type Actor =
  | { type: "user"; id: string; role: Role }
  | { type: "graduate"; id: string }
  | { type: "partner"; id: string; companyId: string }
  | { type: "system"; id: string };

export interface RequestContext {
  actor: Actor;
  ip?: string | null;
  userAgent?: string | null;
}

export function requirePermission(ctx: RequestContext, permission: Permission): asserts ctx is RequestContext & { actor: { type: "user" | "system" } } {
  const a = ctx.actor;
  if (a.type === "system") return; // background jobs run with full rights
  if (a.type !== "user" || !can(a.role, permission)) throw new ForbiddenError();
}

export function systemContext(job: string): RequestContext {
  return { actor: { type: "system", id: job } };
}

export function actorRef(ctx: RequestContext): { actorType: Actor["type"]; actorId: string } {
  return { actorType: ctx.actor.type, actorId: ctx.actor.id };
}
