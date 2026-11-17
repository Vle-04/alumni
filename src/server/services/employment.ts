import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, ROLE_CATEGORIES, SALARY_BANDS, isEmployedStatus } from "@/domain/enums";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { NotFoundError } from "../errors";
import { resolveCompany } from "./companies";

const dateInput = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional());

export const employmentInputSchema = z
  .object({
    status: z.enum(EMPLOYMENT_STATUSES),
    companyName: z.string().trim().max(150).optional(),
    roleTitle: z.string().trim().max(150).optional(),
    roleCategory: z.enum(ROLE_CATEGORIES).optional(),
    inField: z.boolean().optional(),
    startDate: dateInput,
    endDate: dateInput,
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    salaryBand: z.enum(SALARY_BANDS).optional(),
    searchBlockers: z.array(z.string().max(60)).max(10).optional(),
    helpWanted: z.array(z.string().max(60)).max(10).optional(),
    supersedesId: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (isEmployedStatus(v.status) && !v.companyName) ctx.addIssue({ code: "custom", path: ["companyName"], message: "Company is required for employed statuses" });
    if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before start date" });
  });
export type EmploymentInput = z.infer<typeof employmentInputSchema>;

export type RecordSource = Prisma.EmploymentRecordCreateInput["source"];

/**
 * Appends an EmploymentRecord (history is never overwritten) and refreshes the cached
 * current status on the graduate. Callers must have checked permissions.
 */
export async function appendEmploymentRecord(
  db: Db,
  ctx: RequestContext,
  graduateId: string,
  input: EmploymentInput,
  meta: { source: RecordSource; surveyInstanceId?: string; verified?: boolean; reportedAt?: Date },
) {
  const companyId = input.companyName && isEmployedStatus(input.status) ? await resolveCompany(db, input.companyName) : null;
  const employed = isEmployedStatus(input.status);
  const record = await db.employmentRecord.create({
    data: {
      graduateId,
      status: input.status,
      companyId,
      roleTitle: employed ? input.roleTitle || null : null,
      roleCategory: employed ? input.roleCategory ?? null : null,
      inField: employed ? input.inField ?? null : null,
      startDate: employed ? input.startDate ?? null : null,
      endDate: employed ? input.endDate ?? null : null,
      employmentType: employed ? input.employmentType ?? null : null,
      salaryBand: employed ? input.salaryBand ?? null : null,
      searchBlockers: input.status === "searching" ? input.searchBlockers ?? [] : [],
      helpWanted: input.status === "searching" ? input.helpWanted ?? [] : [],
      source: meta.source,
      surveyInstanceId: meta.surveyInstanceId ?? null,
      reportedAt: meta.reportedAt ?? new Date(),
      createdById: ctx.actor.type === "user" ? ctx.actor.id : null,
      verifiedById: meta.verified && ctx.actor.type === "user" ? ctx.actor.id : null,
      supersedesId: input.supersedesId ?? null,
    },
  });
  await refreshCurrentStatus(db, graduateId);
  await audit(db, ctx, { action: "employment.append", entityType: "Graduate", entityId: graduateId, meta: { recordId: record.id, status: record.status, source: record.source } });
  return record;
}

/** Recomputes the cached status fields from history (latest by reportedAt, then createdAt). */
export async function refreshCurrentStatus(db: Db, graduateId: string) {
  const [latest, grad] = await Promise.all([
    db.employmentRecord.findFirst({ where: { graduateId }, orderBy: [{ reportedAt: "desc" }, { createdAt: "desc" }] }),
    db.graduate.findUnique({ where: { id: graduateId }, select: { currentStatus: true, searchingSince: true } }),
  ]);
  if (!grad) throw new NotFoundError("Graduate");
  if (!latest) {
    await db.graduate.update({ where: { id: graduateId }, data: { currentStatus: "unknown", currentStatusAt: null, currentInField: null, searchingSince: null } });
    return;
  }
  let searchingSince: Date | null = null;
  if (latest.status === "searching") {
    // Start of the current uninterrupted run of "searching" records.
    const lastNonSearching = await db.employmentRecord.findFirst({
      where: { graduateId, status: { not: "searching" }, reportedAt: { lte: latest.reportedAt } },
      orderBy: { reportedAt: "desc" },
    });
    const firstOfRun = await db.employmentRecord.findFirst({
      where: { graduateId, status: "searching", ...(lastNonSearching ? { reportedAt: { gt: lastNonSearching.reportedAt } } : {}) },
      orderBy: { reportedAt: "asc" },
    });
    searchingSince = firstOfRun?.reportedAt ?? latest.reportedAt;
  }
  await db.graduate.update({
    where: { id: graduateId },
    data: { currentStatus: latest.status, currentStatusAt: latest.reportedAt, currentInField: latest.inField, searchingSince },
  });
}

/** Staff entry from the graduate detail page. */
export async function addEmploymentRecordAsStaff(ctx: RequestContext, graduateId: string, raw: unknown) {
  requirePermission(ctx, "employment:write");
  const input = employmentInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const g = await tx.graduate.findUnique({ where: { id: graduateId }, select: { id: true, anonymizedAt: true } });
    if (!g || g.anonymizedAt) throw new NotFoundError("Graduate");
    return appendEmploymentRecord(tx, ctx, graduateId, input, { source: "staff_entry", verified: true });
  });
}

/** Marks an existing record as verified by the current staff member. */
export async function verifyEmploymentRecord(ctx: RequestContext, recordId: string) {
  requirePermission(ctx, "employment:write");
  const r = await prisma.employmentRecord.update({ where: { id: recordId }, data: { verifiedById: ctx.actor.id } });
  await audit(prisma, ctx, { action: "employment.verify", entityType: "Graduate", entityId: r.graduateId, meta: { recordId } });
}
