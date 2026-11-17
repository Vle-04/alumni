/**
 * Partner portal (tokenized, no account). A partner contact can:
 *  - submit openings (→ moderation queue)
 *  - see their company's openings and the status of referrals made to them
 * Graduate details are included ONLY when canShareWithPartner(Interested click, share consent) is
 * true at the moment of reading — revoking consent hides them immediately. Every disclosure is audited.
 */
import { z } from "zod";
import { canShareWithPartner, SHARES_WITH_PARTNER } from "@/domain/referrals/pipeline";
import { expiresIn, signToken, verifyToken } from "@/domain/tokens/signedToken";
import { prisma } from "../db";
import { audit } from "../audit";
import { env } from "../env";
import { requirePermission, type RequestContext } from "../context";
import { blindIndex, decryptOpt, encrypt } from "../crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { hasConsent } from "./consent";

export const PARTNER_SESSION_COOKIE = "alumni_partner";
export const PARTNER_LINK_DAYS = 90;
export const PARTNER_SESSION_SECONDS = 8 * 3600;

// ─── Tokens ───

export function partnerLink(c: { id: string; tokenVersion: number }, now = new Date()) {
  return `${env().APP_URL}/p/${signToken({ sub: c.id, v: c.tokenVersion, p: "partner", exp: expiresIn(now, PARTNER_LINK_DAYS * 86400) }, env().TOKEN_SIGNING_KEY)}`;
}

export function partnerSessionValue(c: { id: string; tokenVersion: number }, now = new Date()) {
  return signToken({ sub: c.id, v: c.tokenVersion, p: "session", ref: "partner", exp: expiresIn(now, PARTNER_SESSION_SECONDS) }, env().TOKEN_SIGNING_KEY);
}

export async function resolvePartner(token: string, kind: "link" | "session", now = new Date()) {
  const r = verifyToken(token, env().TOKEN_SIGNING_KEY, now, [kind === "link" ? "partner" : "session"]);
  if (!r.ok) return { ok: false as const, reason: r.reason === "expired" ? "expired" : "invalid" };
  if (kind === "session" && r.payload.ref !== "partner") return { ok: false as const, reason: "invalid" };
  const c = await prisma.partnerContact.findUnique({ where: { id: r.payload.sub }, include: { company: true } });
  if (!c || !c.active || !c.company.isPartner) return { ok: false as const, reason: "invalid" };
  if (c.tokenVersion !== r.payload.v) return { ok: false as const, reason: "revoked" };
  return { ok: true as const, contact: c };
}

// ─── Staff management of partner contacts ───

export async function listPartnerContacts(ctx: RequestContext, companyId: string) {
  requirePermission(ctx, "company:read");
  const rows = await prisma.partnerContact.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  return rows.map(({ emailEnc, emailHash: _h, ...r }) => ({ ...r, email: decryptOpt(emailEnc) }));
}

export async function createPartnerContact(ctx: RequestContext, companyId: string, raw: unknown) {
  requirePermission(ctx, "company:write");
  const input = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().pipe(z.email()) }).parse(raw);
  if (await prisma.partnerContact.findUnique({ where: { emailHash: blindIndex(input.email) } })) throw new ConflictError("A partner contact with this email already exists.");
  const c = await prisma.partnerContact.create({ data: { companyId, name: input.name, emailEnc: encrypt(input.email), emailHash: blindIndex(input.email) } });
  await audit(prisma, ctx, { action: "partner_contact.create", entityType: "Company", entityId: companyId, meta: { contactId: c.id } });
  return c.id;
}

/** Returns a fresh portal link for staff to send to the partner. Rotating revokes older links. */
export async function issuePartnerLink(ctx: RequestContext, contactId: string, rotate: boolean) {
  requirePermission(ctx, "company:write");
  const c = rotate
    ? await prisma.partnerContact.update({ where: { id: contactId }, data: { tokenVersion: { increment: 1 } } })
    : await prisma.partnerContact.findUnique({ where: { id: contactId } });
  if (!c) throw new NotFoundError("Partner contact");
  await audit(prisma, ctx, { action: rotate ? "partner_contact.rotate_link" : "partner_contact.issue_link", entityType: "Company", entityId: c.companyId, meta: { contactId } });
  return partnerLink(c);
}

// ─── Partner-facing view ───

type PartnerCtx = RequestContext & { actor: { type: "partner"; id: string; companyId: string } };
function requirePartner(ctx: RequestContext): asserts ctx is PartnerCtx {
  if (ctx.actor.type !== "partner") throw new ForbiddenError();
}

export interface PartnerCandidate {
  shared: true;
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  skills: string[];
  preferredRoles: string[];
}

export async function partnerDashboard(ctx: RequestContext) {
  requirePartner(ctx);
  const companyId = ctx.actor.companyId;
  const openings = await prisma.opening.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, createdAt: true } });
  // Only referrals actually referred to the partner are visible; earlier stages are internal.
  const refs = await prisma.referral.findMany({
    where: { opening: { companyId }, status: { in: [...SHARES_WITH_PARTNER, "rejected", "withdrawn"] }, graduate: { anonymizedAt: null } },
    orderBy: { statusChangedAt: "desc" },
    include: { opening: { select: { title: true } }, transitions: { select: { toStatus: true } } },
  });
  const visible = refs.filter((r) => r.transitions.some((t) => SHARES_WITH_PARTNER.includes(t.toStatus)));
  const referrals = [];
  for (const r of visible) {
    referrals.push({ id: r.id, openingTitle: r.opening.title, status: r.status, statusChangedAt: r.statusChangedAt, candidate: await partnerCandidate(ctx, r) });
  }
  return { openings, referrals };
}

/**
 * THE sharing gate. Returns the graduate's details only if they clicked Interested for this
 * opening AND currently have share_with_partners consent. Otherwise returns { shared: false }.
 */
export async function partnerCandidate(ctx: RequestContext, ref: { id: string; openingId: string; graduateId: string }): Promise<PartnerCandidate | { shared: false }> {
  requirePartner(ctx);
  const ownOpening = await prisma.opening.count({ where: { id: ref.openingId, companyId: ctx.actor.companyId } });
  if (!ownOpening) throw new ForbiddenError();
  const n = await prisma.matchNotification.findUnique({ where: { openingId_graduateId: { openingId: ref.openingId, graduateId: ref.graduateId } }, select: { response: true } });
  const interested = n?.response === "interested";
  const consent = await hasConsent(prisma, ref.graduateId, "share_with_partners");
  if (!canShareWithPartner(interested, consent)) return { shared: false };
  const g = await prisma.graduate.findUniqueOrThrow({
    where: { id: ref.graduateId },
    select: { fullName: true, preferredName: true, emailEnc: true, linkedinUrlEnc: true, preferredRoleCategories: true, skills: { select: { level: true, skill: { select: { canonicalName: true } } }, orderBy: { level: "desc" } } },
  });
  await audit(prisma, ctx, { action: "contact.read", entityType: "Graduate", entityId: ref.graduateId, meta: { by: "partner", referralId: ref.id, fields: ["name", "email", "linkedinUrl", "skills"] } });
  return {
    shared: true,
    name: g.preferredName ? `${g.preferredName} (${g.fullName})` : g.fullName,
    email: decryptOpt(g.emailEnc),
    linkedinUrl: decryptOpt(g.linkedinUrlEnc),
    skills: g.skills.map((s) => `${s.skill.canonicalName} (${s.level}/5)`),
    preferredRoles: g.preferredRoleCategories,
  };
}
