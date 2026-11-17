import { createHash } from "node:crypto";
import Papa from "papaparse";
import { validateGraduateRows, type ImportPreview, type ValidGraduateRow } from "@/domain/import/graduateCsv";
import { isEmployedStatus } from "@/domain/enums";
import { prisma } from "../db";
import { audit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { blindIndex, encrypt, encryptOpt } from "../crypto";
import { NotFoundError, ValidationError } from "../errors";
import { setGraduateSkills } from "./skills";
import { setConsent } from "./consent";
import { appendEmploymentRecord } from "./employment";
import { onGraduatesCreated } from "./hooks";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

function parseCsv(text: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw new ValidationError("File is larger than 2 MB. Split it into smaller files.");
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  if (res.data.length > MAX_IMPORT_ROWS) throw new ValidationError(`Too many rows (max ${MAX_IMPORT_ROWS}).`);
  return { headers: res.meta.fields ?? [], rows: res.data, parseErrors: res.errors.slice(0, 20).map((e) => ({ row: (e.row ?? 0) + 1, message: e.message })) };
}

async function validate(text: string): Promise<ImportPreview & { parseErrors: { row: number; message: string }[] }> {
  const { headers, rows, parseErrors } = parseCsv(text);
  const cohorts = await prisma.cohort.findMany({ select: { name: true } });
  const hashes = rows.map((r) => (r.email ? blindIndex(r.email) : null)).filter((x): x is string => Boolean(x));
  const existing = new Set((await prisma.graduate.findMany({ where: { emailHash: { in: hashes } }, select: { emailHash: true } })).map((g) => g.emailHash));
  const preview = validateGraduateRows(headers, rows, { cohortNames: cohorts.map((c) => c.name), emailExists: (e) => existing.has(blindIndex(e)) });
  return { ...preview, parseErrors };
}

/** Strips contact data from the preview before it is returned to the browser or stored. */
function publicPreview(p: Awaited<ReturnType<typeof validate>>) {
  return {
    missingColumns: p.missingColumns,
    unknownColumns: p.unknownColumns,
    parseErrors: p.parseErrors,
    counts: p.counts,
    rows: p.rows.map((r) => ({ rowNumber: r.rowNumber, outcome: r.outcome, errors: r.errors, name: r.data?.fullName ?? null, cohort: r.data?.cohortName ?? null })),
  };
}
export type PublicImportPreview = ReturnType<typeof publicPreview> & { batchId: string };

export async function previewImport(ctx: RequestContext, fileName: string, text: string): Promise<PublicImportPreview> {
  requirePermission(ctx, "graduate:import");
  const result = await validate(text);
  const pub = publicPreview(result);
  const batch = await prisma.importBatch.create({
    data: {
      uploadedById: ctx.actor.id,
      fileName: fileName.slice(0, 200),
      contentHash: createHash("sha256").update(text).digest("hex"),
      rowCount: result.rows.length,
      status: "previewed",
      summary: { counts: pub.counts, missingColumns: pub.missingColumns, unknownColumns: pub.unknownColumns },
    },
  });
  await audit(prisma, ctx, { action: "import.preview", entityType: "ImportBatch", entityId: batch.id, meta: { counts: pub.counts } });
  return { ...pub, batchId: batch.id };
}

/**
 * Imports the "new" rows of a previously previewed file. The file content is re-sent by the
 * browser (we never store uploaded PII); its hash must match the preview.
 */
export async function commitImport(ctx: RequestContext, batchId: string, text: string) {
  requirePermission(ctx, "graduate:import");
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.uploadedById !== ctx.actor.id || batch.status !== "previewed") throw new NotFoundError("Import preview");
  if (createHash("sha256").update(text).digest("hex") !== batch.contentHash) throw new ValidationError("The file changed since the preview. Please preview it again.");

  const result = await validate(text); // re-check duplicates: someone may have added graduates since the preview
  const toCreate = result.rows.filter((r) => r.outcome === "new").map((r) => r.data!);
  const cohorts = new Map((await prisma.cohort.findMany({ select: { id: true, name: true } })).map((c) => [c.name, c.id]));
  const created: string[] = [];

  for (let i = 0; i < toCreate.length; i += 50) {
    const chunk = toCreate.slice(i, i + 50);
    const ids = await prisma.$transaction(async (tx) => {
      const out: string[] = [];
      for (const row of chunk) out.push(await createFromRow(tx, ctx, row, cohorts.get(row.cohortName)!));
      return out;
    }, { timeout: 60_000 });
    created.push(...ids);
  }

  const summary = { created: created.length, skippedDuplicates: result.counts.duplicate_existing + result.counts.duplicate_in_file, invalid: result.counts.invalid };
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "committed", summary } });
  await audit(prisma, ctx, { action: "import.commit", entityType: "ImportBatch", entityId: batchId, meta: summary });
  await onGraduatesCreated(ctx, created);
  return summary;
}

async function createFromRow(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], ctx: RequestContext, row: ValidGraduateRow, cohortId: string) {
  const g = await tx.graduate.create({
    data: {
      cohortId,
      fullName: row.fullName,
      emailEnc: encrypt(row.email),
      emailHash: blindIndex(row.email),
      phoneEnc: encryptOpt(row.phone),
      linkedinUrlEnc: encryptOpt(row.linkedinUrl),
      graduationDateOverride: row.graduationDate ?? null,
      timezone: row.timezone ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      remotePreference: row.remotePreference ?? "any",
      openToRelocate: row.openToRelocate ?? false,
      preferredRoleCategories: row.preferredRoles,
    },
  });
  await setGraduateSkills(tx, g.id, row.skills);
  for (const [purpose, granted] of Object.entries(row.consents)) {
    if (granted) await setConsent(tx, ctx, g.id, purpose as keyof typeof row.consents, true, "csv_import");
  }
  if (row.currentStatus) {
    await appendEmploymentRecord(tx, ctx, g.id, {
      status: row.currentStatus,
      companyName: isEmployedStatus(row.currentStatus) ? row.company : undefined,
      roleTitle: row.roleTitle,
      inField: row.inField,
      startDate: row.startDate,
    }, { source: "csv_import" });
  }
  await audit(tx, ctx, { action: "graduate.create", entityType: "Graduate", entityId: g.id, meta: { source: "csv_import" } });
  return g.id;
}
