import { useState } from "react";
import type { Finding, GroupPattern } from "./engine/patterns";

/** Downloads flagged records (rare patterns and blanks). One row per record, with its column, group and pattern. */
export function downloadFlagged(findings: Finding[], filename: string, group?: string) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["row", "column", "kind", "value", "group", "pattern", "pattern_share_pct", "usual_pattern", "usual_share_pct"].join(",")];
  findings.forEach((f) => f.anomalyRecords
    .filter((r) => group === undefined || r.group === group)
    .forEach((r) => lines.push([r.row, f.column, r.kind, r.value, r.group, r.pattern, (r.patternShare * 100).toFixed(2), r.usualPattern, (r.usualShare * 100).toFixed(1)].map(esc).join(","))));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="dq-btn" onClick={onClick} disabled={disabled} title={title}>
      <DownloadIcon /> {label}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M2.5 13.5h11" />
    </svg>
  );
}

const STATUS_TEXT = { assessed: "Assessed", "too-small": "Too small", "no-standard": "No standard" } as const;

function PatternRow({ p, max, active, onSelect }: { p: GroupPattern; max: number; active: boolean; onSelect: () => void }) {
  return (
    <button className={`dq-bar-row${active ? " selected" : ""}`} onClick={onSelect} title="Preview example records">
      <span className="dq-bar-label">{p.pattern}</span>
      <span className="dq-bar-track"><span className={`dq-bar-fill dq-bar-${p.kind}`} style={{ width: `${Math.max((p.count / max) * 100, 1)}%` }} /></span>
      <span className="dq-bar-value">{p.count.toLocaleString()} record{p.count === 1 ? "" : "s"}{p.kind === "blank" ? "" : ` · ${(p.share * 100).toFixed(p.share < 0.01 ? 2 : 1)}%`}</span>
    </button>
  );
}

export function FindingDetail({ finding }: { finding: Finding }) {
  const [groupName, setGroupName] = useState(finding.groups[0]?.group ?? "");
  const [patternKey, setPatternKey] = useState<string | null>(null);

  const group = finding.groups.find((g) => g.group === groupName) ?? finding.groups[0];
  const flagged = group?.patterns.filter((p) => p.kind !== "common") ?? [];
  const common = group?.patterns.filter((p) => p.kind === "common") ?? [];
  const max = Math.max(...(group?.patterns.map((p) => p.count) ?? [1]), 1);
  const selected = group?.patterns.find((p) => p.pattern === patternKey) ?? flagged[0] ?? common[0];
  const chooseGroup = (name: string) => { setGroupName(name); setPatternKey(null); };

  if (!group) return <p className="muted">No values to analyse.</p>;
  return (
    <div className="dq-detail">
      {finding.group ? (
        <>
          <h4>1. Choose a “{finding.group}” group</h4>
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th>Group</th><th>Status</th><th>Records</th><th>Most common pattern</th><th>Share</th><th>Rare records</th></tr></thead>
              <tbody>
                {finding.groups.map((g) => (
                  <tr key={g.group} className={g.group === group.group ? "selected" : ""} onClick={() => chooseGroup(g.group)} title="Show this group's patterns">
                    <td>{g.group}</td>
                    <td><span className={`dq-chip dq-chip-${g.status}`}>{STATUS_TEXT[g.status]}</span></td>
                    <td>{g.records.toLocaleString()}</td>
                    <td className="dq-mono">{g.topPattern}</td>
                    <td>{(g.topShare * 100).toFixed(1)}%</td>
                    <td>{g.anomalies.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h4>{finding.group ? "2. Patterns in" : "Patterns in"} “{finding.column}”{finding.group ? ` — ${group.group}` : ""}</h4>
      {group.note ? <p className="muted dq-hint">{group.note}</p> : null}
      <p className="muted dq-hint">L = letter, N = number, S = special character. Click a pattern to preview example records.</p>
      <div className="dq-pattern-lists">
        <div>
          <div className="dq-list-head dq-list-head-common">
            <div className="dq-list-title">
              <strong>Common — {common.length.toLocaleString()} pattern{common.length === 1 ? "" : "s"}</strong>
              <span>the group's accepted formats</span>
            </div>
          </div>
          {common.length ? common.map((p) => <PatternRow key={p.pattern} p={p} max={max} active={selected?.pattern === p.pattern} onSelect={() => setPatternKey(p.pattern)} />) : <p className="muted dq-hint">No common patterns.</p>}
        </div>
        <div>
          <div className="dq-list-head dq-list-head-rare">
            <div className="dq-list-title">
              <strong>Rare — {flagged.length.toLocaleString()} pattern{flagged.length === 1 ? "" : "s"}</strong>
              <span>used by ≤ {group.cutoffPercent.toFixed(group.cutoffPercent < 1 ? 2 : 0)}% of the group{flagged.some((p) => p.kind === "blank") ? ", plus blanks" : ""}</span>
            </div>
            <ExportButton label="Export flagged" title="Download the flagged records of this group as CSV" onClick={() => downloadFlagged([finding], `flagged-${finding.column}-${group.group}.csv`, group.group)} disabled={!flagged.length} />
          </div>
          {flagged.length ? flagged.map((p) => <PatternRow key={p.pattern} p={p} max={max} active={selected?.pattern === p.pattern} onSelect={() => setPatternKey(p.pattern)} />) : <p className="muted dq-hint">No rare patterns in this group.</p>}
        </div>
      </div>

      {selected ? (
        <div className="dq-preview">
          <h4>Preview — <span className="dq-mono">{selected.pattern}</span> <span className={`dq-chip dq-chip-${selected.kind === "common" ? "assessed" : "review"}`}>{selected.kind === "common" ? "Common" : selected.kind === "blank" ? "Blank" : "Rare"}</span></h4>
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th>Row in file</th><th>{finding.column}</th></tr></thead>
              <tbody>{selected.samples.map((s) => <tr key={s.row}><td>{s.row}</td><td>{selected.kind === "blank" ? <em className="muted">blank</em> : s.value}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted dq-hint">Showing {selected.samples.length.toLocaleString()} of {selected.count.toLocaleString()} record{selected.count === 1 ? "" : "s"} with this pattern.</p>
        </div>
      ) : null}
    </div>
  );
}
