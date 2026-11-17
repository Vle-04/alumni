/**
 * Referral status pipeline:
 *   suggested → graduate_interested → referred → interviewing → offer → hired
 *   … any open stage → rejected | withdrawn
 *
 * Rules:
 *  - Only the GRADUATE can move a referral to graduate_interested (by clicking Interested).
 *  - Moving to referred or beyond shares the graduate's details with the partner, so it requires
 *    the Interested click AND active share_with_partners consent (see canShareWithPartner).
 *  - hired only from offer; hired is final. Staff may step back one stage to fix mistakes,
 *    and may reopen a rejected/withdrawn referral to the stage it was in.
 */
import type { ReferralStatus } from "../enums";

export const PIPELINE: readonly ReferralStatus[] = ["suggested", "graduate_interested", "referred", "interviewing", "offer", "hired"];
export const CLOSED: readonly ReferralStatus[] = ["rejected", "withdrawn"];
export const SHARES_WITH_PARTNER: readonly ReferralStatus[] = ["referred", "interviewing", "offer", "hired"];

export interface TransitionContext {
  actor: "staff" | "graduate";
  /** Highest pipeline stage this referral ever reached (used to reopen closed referrals). */
  lastOpenStatus?: ReferralStatus;
  interested: boolean;
  shareConsent: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canShareWithPartner(interested: boolean, shareConsent: boolean): boolean {
  return interested && shareConsent;
}

export function checkTransition(from: ReferralStatus, to: ReferralStatus, ctx: TransitionContext): TransitionCheck {
  if (from === to) return { ok: false, reason: "The referral is already in this stage." };
  if (from === "hired") return { ok: false, reason: "Hired is final. Record a new employment change on the graduate instead." };
  if (to === "graduate_interested" && ctx.actor !== "graduate") return { ok: false, reason: "Only the graduate can say they're interested (from their personal link)." };
  if (ctx.actor === "graduate" && !(to === "graduate_interested" || to === "withdrawn")) return { ok: false, reason: "Graduates can only say Interested or Not interested." };
  if (SHARES_WITH_PARTNER.includes(to) && !canShareWithPartner(ctx.interested, ctx.shareConsent)) {
    return { ok: false, reason: !ctx.interested ? "The graduate hasn't said they're interested yet." : "The graduate hasn't agreed to share their details with partners." };
  }
  if (CLOSED.includes(to)) return { ok: true };

  const toIdx = PIPELINE.indexOf(to);
  if (CLOSED.includes(from)) {
    const back = ctx.lastOpenStatus ? PIPELINE.indexOf(ctx.lastOpenStatus) : 0;
    return toIdx <= back ? { ok: true } : { ok: false, reason: "A reopened referral returns to the stage it was in (or earlier)." };
  }
  const fromIdx = PIPELINE.indexOf(from);
  if (to === "hired" && from !== "offer") return { ok: false, reason: "Move the referral to Offer before Hired." };
  if (toIdx === fromIdx + 1 || toIdx === fromIdx - 1) return { ok: true };
  if (toIdx > fromIdx + 1 && from !== "suggested") return { ok: true }; // skipping stages forward (e.g. referred → offer) is allowed after interest
  if (from === "suggested" && toIdx > 1) return { ok: false, reason: "The graduate has to say they're interested first." };
  return { ok: false, reason: "Move one stage back at a time." };
}

export function allowedTargets(from: ReferralStatus, ctx: TransitionContext): ReferralStatus[] {
  return [...PIPELINE, ...CLOSED].filter((to) => checkTransition(from, to, ctx).ok);
}
