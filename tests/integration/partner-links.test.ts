/** Audit item 5: partner portal links expire and can be revoked. */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { blindIndex, encrypt } from "@/server/crypto";
import { issuePartnerLink, partnerSessionValue, resolvePartner, PARTNER_LINK_DAYS } from "@/server/services/partner";
import { resetDb, staff } from "./helpers";

const tokenOf = (url: string) => url.split("/p/")[1]!;

describe("partner portal links", () => {
  let contactId: string;
  beforeEach(async () => {
    await resetDb();
    const c = await prisma.company.create({ data: { canonicalName: "Partner Co", isPartner: true } });
    contactId = (await prisma.partnerContact.create({ data: { companyId: c.id, name: "Pat", emailEnc: encrypt("pat@p.test"), emailHash: blindIndex("pat@p.test") } })).id;
  });

  it("expire after 90 days", async () => {
    const admin = await staff("ADMIN");
    const t = tokenOf(await issuePartnerLink(admin, contactId, false));
    expect((await resolvePartner(t, "link")).ok).toBe(true);
    const later = new Date(Date.now() + (PARTNER_LINK_DAYS * 86400 + 60) * 1000);
    expect(await resolvePartner(t, "link", later)).toEqual({ ok: false, reason: "expired" });
  });

  it("are revoked by 'Revoke & reissue' — old links AND open sessions stop working", async () => {
    const admin = await staff("ADMIN");
    const old = tokenOf(await issuePartnerLink(admin, contactId, false));
    const session = partnerSessionValue((await prisma.partnerContact.findUniqueOrThrow({ where: { id: contactId } })));
    const fresh = tokenOf(await issuePartnerLink(admin, contactId, true));
    expect(await resolvePartner(old, "link")).toEqual({ ok: false, reason: "revoked" });
    expect(await resolvePartner(session, "session")).toEqual({ ok: false, reason: "revoked" });
    expect((await resolvePartner(fresh, "link")).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "partner_contact.rotate_link" } })).toBe(1);
  });

  it("stop working when the contact is deactivated or the company stops being a partner", async () => {
    const t = tokenOf(await issuePartnerLink(await staff("ADMIN"), contactId, false));
    await prisma.partnerContact.update({ where: { id: contactId }, data: { active: false } });
    expect((await resolvePartner(t, "link")).ok).toBe(false);
    await prisma.partnerContact.update({ where: { id: contactId }, data: { active: true } });
    await prisma.company.updateMany({ data: { isPartner: false } });
    expect((await resolvePartner(t, "link")).ok).toBe(false);
  });

  it("only staff with company:write can issue or revoke them", async () => {
    await expect(issuePartnerLink(await staff("LEADERSHIP"), contactId, true)).rejects.toThrow();
  });
});
