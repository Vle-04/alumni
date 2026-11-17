/** One-page PDF for leadership. Aggregates only (input is an already-suppressed OutcomesReport). */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { OutcomesReport } from "@/domain/metrics/report";
import { METRIC_DEFINITIONS } from "@/domain/metrics/definitions";
import type { ReportFilters } from "../services/reports";

const C = { ink: "#16181d", muted: "#555b66", rule: "#d9dce1", series1: "#2a78d6", track: "#eef1f5" };
const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: C.ink, fontFamily: "Helvetica" },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  sub: { color: C.muted, marginTop: 2, marginBottom: 12 },
  tiles: { flexDirection: "row", gap: 8, marginBottom: 12 },
  tile: { flex: 1, borderWidth: 1, borderColor: C.rule, borderRadius: 4, padding: 8 },
  tileLabel: { color: C.muted, fontSize: 8 },
  tileValue: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 2 },
  tileNote: { color: C.muted, fontSize: 7.5, marginTop: 2 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: C.rule, paddingVertical: 2.5 },
  th: { fontFamily: "Helvetica-Bold", color: C.muted },
  cols: { flexDirection: "row", gap: 16 },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 2 },
  barTrack: { flex: 1, height: 7, backgroundColor: C.track, marginHorizontal: 4 },
  foot: { position: "absolute", bottom: 20, left: 32, right: 32, color: C.muted, fontSize: 7 },
});

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (<View style={s.tile}><Text style={s.tileLabel}>{label}</Text><Text style={s.tileValue}>{value}</Text>{note && <Text style={s.tileNote}>{note}</Text>}</View>);
}

function filtersText(f: ReportFilters, r: OutcomesReport) {
  const parts = [f.from || f.to ? `Graduated ${f.from ?? "…"} to ${f.to ?? "…"}` : "All graduation dates", f.programId || f.cohortId ? "Filtered by program/cohort" : "All programs"];
  return `${parts.join(" · ")} · ${r.population.graduates.display} graduates in ${r.population.cohortsIncluded} cohorts · generated ${r.generatedAt.slice(0, 10)}`;
}

function ReportDoc({ r, f }: { r: OutcomesReport; f: ReportFilters }) {
  const [m6, m12] = r.milestones;
  const rateNote = (m: typeof m6) => (m ? `Response ${m.responseRate.display} · unknown ${m.unknown.display} · if unknowns weren't employed: ${m.employmentRateLowerBound.display}` : "");
  const t = r.timeToJob;
  return (
    <Document title="Alumni outcomes" author="Academy Careers">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Graduate outcomes</Text>
        <Text style={s.sub}>{filtersText(f, r)}</Text>
        {r.tooSmall ? <Text>Fewer than {r.config.minCell} graduates match these filters, so no figures are shown.</Text> : (
          <>
            <View style={s.tiles}>
              <Tile label="Employed at 6 months" value={m6!.employmentRate.display} note={rateNote(m6)} />
              <Tile label="Employed at 12 months" value={m12!.employmentRate.display} note={rateNote(m12)} />
              <Tile label="Median days to first job" value={t.median === null ? (t.suppressed ? "—" : "not yet") : String(t.median)} note={t.p25 !== null ? `25th–75th percentile: ${t.p25}–${t.p75 ?? "not yet"} days` : undefined} />
              <Tile label="Records updated in 90 days" value={r.freshness.display} />
            </View>
            <View style={s.cols}>
              <View style={{ flex: 1 }}>
                <Text style={s.h2}>Employed by month after graduation</Text>
                {t.curve.filter((p) => p.month % 2 === 0).map((p) => (
                  <View key={p.month} style={s.barRow}>
                    <Text style={{ width: 52 }}>Month {p.month}</Text>
                    <View style={s.barTrack}><View style={{ width: `${Math.round(p.pctEmployed * 100)}%`, height: 7, backgroundColor: C.series1 }} /></View>
                    <Text style={{ width: 28, textAlign: "right" }}>{Math.round(p.pctEmployed * 100)}%</Text>
                  </View>
                ))}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.h2}>Top employers</Text>
                {r.topEmployers.length === 0 && <Text style={{ color: C.muted }}>No employer has 5 or more graduates yet.</Text>}
                {r.topEmployers.map((e) => (
                  <View key={e.name} style={s.row}><Text style={{ flex: 1 }}>{e.name}{e.isPartner ? "  (partner)" : ""}</Text><Text>{e.hires}</Text></View>
                ))}
                <View style={s.row}><Text style={{ flex: 1, color: C.muted }}>Other employers ({r.otherEmployers.companies})</Text><Text>{r.otherEmployers.hires.display}</Text></View>
              </View>
            </View>
            <Text style={s.h2}>Cohorts</Text>
            <View style={[s.row, s.th]}><Text style={{ flex: 2 }}>Cohort</Text><Text style={{ flex: 1 }}>Graduates</Text><Text style={{ flex: 1 }}>Response 6m</Text><Text style={{ flex: 1 }}>Employed 6m</Text><Text style={{ flex: 1 }}>Employed 12m</Text><Text style={{ flex: 1 }}>Median days</Text></View>
            {r.cohorts.map((c) => (
              <View key={c.id} style={s.row}><Text style={{ flex: 2 }}>{c.name}</Text><Text style={{ flex: 1 }}>{c.graduates.display}</Text><Text style={{ flex: 1 }}>{c.responseRate6.display}</Text><Text style={{ flex: 1 }}>{c.rate6.display}</Text><Text style={{ flex: 1 }}>{c.rate12.display}</Text><Text style={{ flex: 1 }}>{c.medianDays ?? "—"}</Text></View>
            ))}
          </>
        )}
        <View style={s.foot}>
          <Text>Employment rate: {METRIC_DEFINITIONS.employmentRate}</Text>
          <Text style={{ marginTop: 3 }}>{METRIC_DEFINITIONS.suppression} Excluded for lack of reporting consent: {r.population.excludedNoConsent.display}; in cohorts too small to report: {r.population.excludedSmallCohorts.display}.</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(r: OutcomesReport, f: ReportFilters): Promise<Buffer> {
  return renderToBuffer(<ReportDoc r={r} f={f} />);
}
