"use client";
import { useRef, type ReactNode } from "react";
import { InfoTip } from "../InfoTip";
import { svgToPng } from "./exportPng";

export interface TableSpec {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Chart frame: title + definition tooltip, the chart, a table-view twin (every value readable
 * without color or hover), and an optional PNG download (logged before it happens).
 */
export function ChartCard({ id, title, definition, table, children, onExport, note }: {
  id: string; title: string; definition: string; table: TableSpec; children: ReactNode; note?: ReactNode;
  onExport?: (chart: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  async function download() {
    const svg = ref.current?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    if (!svg || !onExport) return;
    await onExport(id);
    await svgToPng(svg, `${id}.png`, title);
  }
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold">{title}<InfoTip label={title} text={definition} /></h2>
        {onExport && <button type="button" onClick={download} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2">Download PNG</button>}
      </div>
      {note && <p className="mb-2 text-xs text-muted">{note}</p>}
      <div ref={ref}>{children}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-accent">Show data table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{table.caption}</caption>
            <thead><tr>{table.columns.map((c) => <th key={c} scope="col" className="border-b border-border px-2 py-1 text-left text-xs text-muted">{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="border-b border-border px-2 py-1 tabular-nums">{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
