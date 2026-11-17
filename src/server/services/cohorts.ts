import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { NotFoundError, ConflictError } from "../errors";
import { onCohortGraduationDateChanged } from "./hooks";

const date = z.coerce.date();
const optDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional());

export const cohortInputSchema = z
  .object({
    programId: z.string().min(1, "Choose a program"),
    name: z.string().trim().min(2).max(120),
    startDate: date,
    graduationDate: optDate,
    plannedSize: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(10000).optional()),
  })
  .refine((v) => !v.graduationDate || v.graduationDate > v.startDate, { path: ["graduationDate"], message: "Graduation must be after the start date" });

export async function listPrograms() {
  return prisma.program.findMany({ orderBy: { name: "asc" } });
}

/** Cohort list with headcounts only — safe for every staff role. */
export async function listCohorts(ctx: RequestContext) {
  requirePermission(ctx, "cohort:read_aggregate");
  return prisma.cohort.findMany({ orderBy: [{ startDate: "desc" }], include: { program: true, _count: { select: { graduates: true } } } });
}

export async function createProgram(ctx: RequestContext, name: string) {
  requirePermission(ctx, "cohort:write");
  const n = z.string().trim().min(2).max(120).parse(name);
  const p = await prisma.program.create({ data: { name: n } });
  await audit(prisma, ctx, { action: "program.create", entityType: "Program", entityId: p.id, after: { name: n } });
  return p.id;
}

export async function createCohort(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "cohort:write");
  const input = cohortInputSchema.parse(raw);
  if (await prisma.cohort.findUnique({ where: { name: input.name } })) throw new ConflictError("A cohort with this name already exists.");
  const c = await prisma.cohort.create({ data: { ...input, graduationDate: input.graduationDate ?? null, plannedSize: input.plannedSize ?? null } });
  await audit(prisma, ctx, { action: "cohort.create", entityType: "Cohort", entityId: c.id, after: input });
  if (c.graduationDate) await onCohortGraduationDateChanged(ctx, c.id);
  return c.id;
}

export async function updateCohort(ctx: RequestContext, id: string, raw: unknown) {
  requirePermission(ctx, "cohort:write");
  const input = cohortInputSchema.parse(raw);
  const before = await prisma.cohort.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Cohort");
  const after = await prisma.cohort.update({ where: { id }, data: { ...input, graduationDate: input.graduationDate ?? null, plannedSize: input.plannedSize ?? null } });
  await audit(prisma, ctx, { action: "cohort.update", entityType: "Cohort", entityId: id, before, after });
  if ((before.graduationDate?.getTime() ?? null) !== (after.graduationDate?.getTime() ?? null)) await onCohortGraduationDateChanged(ctx, id);
  return id;
}
