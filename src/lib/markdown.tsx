/**
 * Tiny, safe Markdown renderer for our own docs (headings, paragraphs, bullet lists, tables,
 * **bold**). Produces React elements only — never raw HTML — so nothing can be injected.
 */
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("# ")) { out.push(<h1 key={i} className="text-2xl font-semibold">{inline(line.slice(2))}</h1>); i++; continue; }
    if (line.startsWith("## ")) { out.push(<h2 key={i} className="mt-6 text-lg font-semibold">{inline(line.slice(3))}</h2>); i++; continue; }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) items.push(lines[i++]!.slice(2));
      out.push(<ul key={i} className="list-disc space-y-1 pl-5">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i++]!.split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      out.push(
        <div key={i} role="region" aria-label="Table" tabIndex={0} className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr>{head!.map((c, j) => <th key={j} scope="col" className="border-b border-border px-2 py-1 text-left">{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-border px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#|- |\|)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(<p key={i}>{inline(para.join(" "))}</p>);
  }
  return <div className="space-y-3 leading-relaxed">{out}</div>;
}
