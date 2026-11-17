import type { ConsentPurpose } from "@/domain/enums";
import type { Db } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import type { RequestContext } from "../context";

export async function activeConsents(db: Db, graduateId: string): Promise<Set<ConsentPurpose>> {
  const rows = await db.consent.findMany({ where: { graduateId, revokedAt: null }, select: { purpose: true } });
  return new Set(rows.map((r) => r.purpose));
}

export async function hasConsent(db: Db, graduateId: string, purpose: ConsentPurpose): Promise<boolean> {
  return (await db.consent.count({ where: { graduateId, purpose, revokedAt: null } })) > 0;
}

/** Grants or revokes one purpose. Revocation takes effect immediately (no caching anywhere). */
export async function setConsent(db: Db, ctx: RequestContext, graduateId: string, purpose: ConsentPurpose, granted: boolean, source: string) {
  const active = await db.consent.findFirst({ where: { graduateId, purpose, revokedAt: null } });
  if (granted && !active) {
    await db.consent.create({ data: { graduateId, purpose, policyVersion: env().PRIVACY_POLICY_VERSION, source } });
    await audit(db, ctx, { action: "consent.grant", entityType: "Graduate", entityId: graduateId, meta: { purpose, source } });
  } else if (!granted && active) {
    await db.consent.updateMany({ where: { graduateId, purpose, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(db, ctx, { action: "consent.revoke", entityType: "Graduate", entityId: graduateId, meta: { purpose, source } });
  }
}
