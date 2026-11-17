"use client";
/**
 * Recharts wrappers that apply the chart spec: categorical slots in fixed order (color follows
 * the entity), thin marks with 4px rounded data-ends, 2px surface gaps, hairline solid grid,
 * hover tooltips, legends only for ≥2 series, one y-axis only.
 */
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
const axis = { stroke: "var(--chart-grid)", tick: { fill: "var(--chart-axis)", fontSize: 12 }, tickLine: false };
const tooltipStyle = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--fg)", fontSize: 12 }, labelStyle: { color: "var(--fg)", fontWeight: 600 }, cursor: { fill: "var(--surface-2)" } };
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Legend labels wear text ink (the colored marker carries identity), in series order — not alphabetical. */
const legendText = (value: string) => <span style={{ color: "var(--fg)" }}>{value}</span>;
const inOrder = (names: string[]) => (item: { value?: unknown }) => names.indexOf(String(item.value));

/** Single-series horizontal bars (one color for every bar — no value ramp on nominal categories). */
export function HBar({ data, valueLabel, format = (v) => String(v) }: { data: { label: string; value: number | null }[]; valueLabel: string; format?: (v: number) => string }) {
  const height = Math.max(120, data.length * 30 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" {...axis} tickFormatter={format} allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={170} {...axis} axisLine={false} interval={0} />
        <Tooltip {...tooltipStyle} formatter={(v) => [v === null || v === undefined ? "hidden (<5)" : format(Number(v)), valueLabel]} />
        <Bar dataKey="value" name={valueLabel} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}
          label={{ position: "right", fill: "var(--chart-axis)", fontSize: 11, formatter: (v: unknown) => (typeof v === "number" ? format(v) : "") }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ordered categories (e.g. salary bands), single hue, vertical. */
export function VBar({ data, valueLabel }: { data: { label: string; value: number | null }[]; valueLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 4 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...axis} interval={0} fontSize={11} />
        <YAxis {...axis} axisLine={false} allowDecimals={false} width={32} />
        <Tooltip {...tooltipStyle} formatter={(v) => [v ?? "hidden (<5)", valueLabel]} />
        <Bar dataKey="value" name={valueLabel} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Grouped bars for two measures on the same 0–100% scale (one axis). */
export function GroupedRate({ data, series }: { data: Record<string, string | number | null>[]; series: { key: string; label: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} barGap={2} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...axis} interval={0} fontSize={11} />
        <YAxis {...axis} axisLine={false} domain={[0, 1]} tickFormatter={pct} width={40} />
        <Tooltip {...tooltipStyle} formatter={(v, name) => [v === null || v === undefined ? "hidden (small group)" : pct(Number(v)), name]} />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} itemSorter={inOrder(series.map((x) => x.label))} />
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Cumulative "% employed by month" lines; one per entity (cohort), color fixed by entity order. */
export function CurveChart({ data, series }: { data: Record<string, number | null>[]; series: { key: string; label: string; slot: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" {...axis} tickFormatter={(m) => `M${m}`} />
        <YAxis {...axis} axisLine={false} domain={[0, 1]} tickFormatter={pct} width={40} />
        <Tooltip {...tooltipStyle} cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} labelFormatter={(m) => `Month ${m}`} formatter={(v, name) => [v === null || v === undefined ? "hidden" : pct(Number(v)), name]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} itemSorter={inOrder([...series].sort((a, b) => a.slot - b.slot).map((x) => x.label))} />}
        {series.map((s) => (
          <Line key={s.key} type="stepAfter" dataKey={s.key} name={s.label} stroke={SERIES[s.slot % SERIES.length]} strokeWidth={2} dot={false}
            activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
