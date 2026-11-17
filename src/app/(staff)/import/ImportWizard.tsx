"use client";
import { useState, useTransition } from "react";
import { Alert, Badge, Button, Table, Td, Th, type Tone } from "@/components/ui";
import type { PublicImportPreview } from "@/server/services/import";
import { commitImportAction, previewImportAction } from "./actions";

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  new: { label: "Will be created", tone: "success" },
  duplicate_in_file: { label: "Duplicate in file", tone: "warning" },
  duplicate_existing: { label: "Already exists", tone: "warning" },
  invalid: { label: "Has errors", tone: "danger" },
};

export function ImportWizard() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PublicImportPreview | null>(null);
  const [result, setResult] = useState<{ created: number; skippedDuplicates: number; invalid: number } | null>(null);
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();

  async function onFile(f: File | undefined) {
    setPreview(null); setResult(null); setError(undefined);
    if (!f) return setFile(null);
    setFile({ name: f.name, text: await f.text() });
  }

  const rows = preview ? (showAll ? preview.rows : preview.rows.filter((r) => r.outcome !== "new")) : [];
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="csv" className="block text-sm font-medium">CSV file</label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="mt-1 block text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2" />
      </div>
      <Button disabled={!file || pending} onClick={() => start(async () => {
        const r = await previewImportAction(file!.name, file!.text);
        if (r.ok) setPreview(r.data); else setError(r.error);
      })}>{pending && !preview ? "Checking…" : "Preview (dry run)"}</Button>
      {error && <Alert tone="danger">{error}</Alert>}

      {preview && !result && (
        <div className="space-y-3" aria-live="polite">
          {preview.missingColumns.length > 0 && <Alert tone="danger">Missing required columns: {preview.missingColumns.join(", ")}</Alert>}
          {preview.unknownColumns.length > 0 && <Alert tone="warning">These columns will be ignored: {preview.unknownColumns.join(", ")}</Alert>}
          {preview.parseErrors.length > 0 && <Alert tone="warning">CSV format problems: {preview.parseErrors.map((e) => `row ${e.row}: ${e.message}`).join("; ")}</Alert>}
          <p className="text-sm">
            <strong>{preview.counts.new}</strong> new · <strong>{preview.counts.duplicate_existing + preview.counts.duplicate_in_file}</strong> duplicates (skipped) · <strong>{preview.counts.invalid}</strong> with errors (skipped)
          </p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show rows that will be created too</label>
          {rows.length > 0 && (
            <Table caption="Import preview rows">
              <thead><tr><Th>Row</Th><Th>Name</Th><Th>Result</Th><Th>Problems</Th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.rowNumber}><Td>{r.rowNumber}</Td><Td>{r.name ?? "—"}</Td><Td><Badge tone={OUTCOME[r.outcome]!.tone}>{OUTCOME[r.outcome]!.label}</Badge></Td>
                  <Td><ul className="text-xs">{r.errors.map((e, i) => <li key={i}><strong>{e.field}</strong>: {e.message}</li>)}</ul></Td></tr>
              ))}</tbody>
            </Table>
          )}
          <Button disabled={pending || preview.counts.new === 0} onClick={() => start(async () => {
            const r = await commitImportAction(preview.batchId, file!.text);
            if (r.ok) setResult(r.data); else setError(r.error);
          })}>{pending ? "Importing…" : `Import ${preview.counts.new} graduates`}</Button>
        </div>
      )}
      {result && <Alert tone="success">Imported {result.created} graduates. Skipped {result.skippedDuplicates} duplicates and {result.invalid} rows with errors.</Alert>}
    </div>
  );
}
