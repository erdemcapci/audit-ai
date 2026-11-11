import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Badge } from "../../components/Badge";
import { parseCsv, type Dataset } from "./csv";
import { downloadFlagged, ExportButton, FindingDetail } from "./FindingDetail";
import { analyzeDataset, DEFAULT_OPTIONS, profileDataset, type ColumnProfile, type Finding, type Options, type Priority } from "./patterns";

const PRIORITY_LABEL: Record<Priority, string> = { high: "High priority", medium: "Medium", low: "Low", clean: "Clean" };
const PRIORITY_TONE: Record<Priority, "red" | "amber" | "blue" | "green"> = { high: "red", medium: "amber", low: "blue", clean: "green" };
const VERDICT_LABEL = { suitable: "Suitable", review: "Needs review", unsuitable: "Not suitable" } as const;

export function DataQualityScreen() {
  const [data, setData] = useState<Dataset | null>(null);
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Stage 1: lightweight profiling (re-runs only if the pattern alphabet changes).
  const profiles = useMemo(() => (data ? profileDataset(data, options.keepSpecial) : []), [data, options.keepSpecial]);
  // Stage 2: full-data analysis of the selected columns.
  const analysis = useMemo(() => (data ? analyzeDataset(data, profiles, options) : null), [data, profiles, options]);
  const activeFinding = analysis?.findings.find((f) => f.column === selected) ?? null;

  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadFile(file);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  async function loadFile(file: File) {
    setError("");
    try {
      const parsed = parseCsv(await file.text(), file.name);
      if (!parsed.headers.length || !parsed.rows.length) throw new Error("The file has no data rows.");
      setData(parsed);
      setOptions(DEFAULT_OPTIONS);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read the file.");
    }
  }

  const patch = (next: Partial<Options>) => setOptions((current) => ({ ...current, ...next }));

  return (
    <section className="screen-panel dq-screen">
      <div className="screen-header">
        <div>
          <h2>Data Quality — Character Patterns</h2>
        </div>
        <div className="dq-file-bar">
          {data ? (
            <span className="dq-file-chip" title={data.name}>
              <FileIcon />
              <span className="dq-file-name">{data.name}</span>
              <span className="dq-file-meta">{data.rows.length.toLocaleString()} rows</span>
            </span>
          ) : null}
          {data ? <button className="dq-btn" onClick={() => fileInput.current?.click()}><UploadIcon /> Replace file</button> : null}
          <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onPick} hidden />
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}

      {!data || !analysis ? (
        <div
          className={`dq-dropzone${dragging ? " dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <UploadIcon size={28} />
          <strong>Drop a CSV file here</strong>
          <span>Customers, vendors, invoices, journal entries — Assurenodia will find identifiers such as tax numbers, IDs and codes that break their usual format.</span>
          <button className="dq-btn dq-btn-primary" onClick={() => fileInput.current?.click()}>Choose file</button>
        </div>
      ) : (
        <>
          <div className="dq-kpis">
            <Kpi label="Records" value={data.rows.length.toLocaleString()} />
            <Kpi label="Columns profiled" value={String(data.headers.length)} />
            <Kpi label="Columns analysed" value={String(analysis.findings.length)} />
            <Kpi label="Columns excluded" value={String(analysis.excluded.length)} />
            <Kpi label="Non-standard records" value={analysis.anomalousRecords.toLocaleString()} tone={analysis.anomalousRecords ? "alert" : "ok"} />
          </div>
          <div className="dq-section-head">
            <h3>Findings</h3>
            <ExportButton label="Export all flagged" title="Download the flagged records of every analysed column as one CSV" onClick={() => downloadFlagged(analysis.findings, `flagged-${data.name.replace(/\.[^.]+$/, "")}.csv`)} disabled={!analysis.anomalousRecords && !analysis.findings.some((f) => f.blank)} />
          </div>
          {analysis.findings.length ? (
            <div className="dq-findings">
              {analysis.findings.map((f) => (
                <FindingCard key={f.column} finding={f} active={f.column === selected} onSelect={() => setSelected(f.column === selected ? null : f.column)} />
              ))}
            </div>
          ) : (
            <div className="dq-empty"><strong>No columns were suitable for pattern analysis</strong><span>See the excluded columns below, or force a column in under Advanced settings.</span></div>
          )}
          {activeFinding ? (
            <div className="dq-detail-panel">
              <div className="dq-section-head">
                <h3>{activeFinding.column}</h3>
                <ExportButton label="Export flagged" title={`Download the flagged records of ${activeFinding.column} (all groups) as CSV`} onClick={() => downloadFlagged([activeFinding], `flagged-${activeFinding.column}.csv`)} disabled={!activeFinding.anomalyRecords.length} />
              </div>
              <FindingDetail key={activeFinding.column} finding={activeFinding} />
            </div>
          ) : null}

          {analysis.excluded.length ? <ExcludedTable columns={analysis.excluded} /> : null}
          <AdvancedSettings headers={data.headers} profiles={profiles} options={options} onChange={patch} />
        </>
      )}
    </section>
  );
}

function UploadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5.2h3.5" />
    </svg>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "alert" | "ok" }) {
  return <div className={`dq-kpi${tone ? ` dq-kpi-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function FindingCard({ finding, active, onSelect }: { finding: Finding; active: boolean; onSelect: () => void }) {
  const top = finding.patterns.slice(0, 6);
  const topShare = top.reduce((n, p) => n + p.share, 0);
  return (
    <button className={`dq-finding dq-finding-${finding.priority}${active ? " active" : ""}`} onClick={onSelect} aria-expanded={active}>
      <div className="dq-finding-head">
        <strong>{finding.column}</strong>
        <Badge tone={PRIORITY_TONE[finding.priority]}>{PRIORITY_LABEL[finding.priority]}</Badge>
      </div>
      <div className="dq-finding-count" title={`${finding.anomalies.toLocaleString()} non-standard of ${finding.assessed.toLocaleString()} records (${finding.anomalyPercent.toFixed(2)}%)`}>
        <span>{finding.anomalies.toLocaleString()}</span>
      </div>
      <div className="dq-stack" aria-label="Share of records by pattern">
        {top.map((p, i) => <span key={p.pattern} className={`dq-seg dq-seg-${i}`} style={{ width: `${p.share * 100}%` }} title={`${p.pattern}: ${(p.share * 100).toFixed(1)}%`} />)}
        {topShare < 1 ? <span className="dq-seg dq-seg-other" style={{ width: `${(1 - topShare) * 100}%` }} title="Other patterns" /> : null}
      </div>
      <div className="dq-finding-meta">
        <span>{finding.group ? `Compared within “${finding.group}”` : "Compared across all records"}</span>
        <span>{finding.patterns.length.toLocaleString()} pattern{finding.patterns.length === 1 ? "" : "s"}{finding.blank ? ` · ${finding.blank.toLocaleString()} blank` : ""}</span>
      </div>
    </button>
  );
}

function ExcludedTable({ columns }: { columns: ColumnProfile[] }) {
  return (
    <details className="dq-section" open>
      <summary>Columns not analysed ({columns.length}) and why</summary>
      <div className="dq-table-wrap">
        <table className="dq-table">
          <thead><tr><th>Column</th><th>Assessment</th><th>Reason</th><th>Example values</th></tr></thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.column}>
                <td>{c.column}</td>
                <td><span className={`dq-chip dq-chip-${c.verdict}`}>{VERDICT_LABEL[c.verdict]}</span></td>
                <td>{c.reasons.join(" ")}</td>
                <td className="dq-mono">{c.examples.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AdvancedSettings({ headers, profiles, options, onChange }: { headers: string[]; profiles: ColumnProfile[]; options: Options; onChange: (next: Partial<Options>) => void }) {
  const setInclude = (column: string, value: boolean | undefined) => {
    const next = { ...options.include };
    if (value === undefined) delete next[column]; else next[column] = value;
    onChange({ include: next });
  };
  const setGroup = (column: string, value: string) => {
    const next = { ...options.group };
    if (value === "auto") delete next[column]; else next[column] = value;
    onChange({ group: next });
  };
  return (
    <details className="dq-section">
      <summary>Advanced settings (optional)</summary>
      <div className="dq-advanced">
        <label>
          <span className="dq-label">Rare-pattern threshold (% of group)</span>
          <input type="number" min={0} max={50} step={0.5} value={options.thresholdPercent} onChange={(e) => onChange({ thresholdPercent: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })} />
        </label>
        <label className="dq-check"><input type="checkbox" checked={options.keepSpecial} onChange={(e) => onChange({ keepSpecial: e.target.checked })} /> Keep special characters as they are (otherwise “S”)</label>
      </div>
      <div className="dq-table-wrap">
        <table className="dq-table">
          <thead><tr><th>Column</th><th>Automatic assessment</th><th>Analyse</th><th>Compare within</th></tr></thead>
          <tbody>
            {profiles.map((p) => {
              const auto = p.verdict === "suitable";
              const forced = options.include[p.column];
              return (
                <tr key={p.column}>
                  <td>{p.column}</td>
                  <td><span className={`dq-chip dq-chip-${p.verdict}`}>{VERDICT_LABEL[p.verdict]}</span></td>
                  <td>
                    <select value={forced === undefined ? "auto" : forced ? "yes" : "no"} onChange={(e) => setInclude(p.column, e.target.value === "auto" ? undefined : e.target.value === "yes")} aria-label={`Analyse ${p.column}`}>
                      <option value="auto">Automatic ({auto ? "yes" : "no"})</option>
                      <option value="yes">Always</option>
                      <option value="no">Never</option>
                    </select>
                  </td>
                  <td>
                    <select value={options.group[p.column] ?? "auto"} onChange={(e) => setGroup(p.column, e.target.value)} aria-label={`Group ${p.column} by`}>
                      <option value="auto">Automatic{p.grouping ? ` (${p.grouping.column})` : " (none)"}</option>
                      <option value="none">No grouping</option>
                      {headers.filter((h) => h !== p.column).map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
