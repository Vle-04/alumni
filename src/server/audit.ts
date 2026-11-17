import type { Prisma } from "@prisma/client";
import { auditDiff } from "@/domain/audit/redact";
import type { Db } from "./db";
import type { RequestContext } from "./context";

export interface AuditEntry {
  action: string; // e.g. "graduate.update", "contact.read", "report.export"
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Extra non-personal metadata (e.g. export format, filters). */
  meta?: Record<string, unknown>;
}

export async function audit(db: Db, ctx: RequestContext, e: AuditEntry): Promise<void> {
  const diff = e.before !== undefined || e.after !== undefined ? auditDiff(e.before ?? null, e.after ?? null) : undefined;
  const payload = diff || e.meta ? ({ ...(diff ? { changes: diff } : {}), ...(e.meta ? { meta: e.meta } : {}) } as Prisma.InputJsonValue) : undefined;
  await db.auditLog.create({
    data: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      diff: payload,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    },
  });
}
