import { useState } from "react";
import type { Finding } from "./engine/patterns";
import { getTemplate } from "./engine/templates/registry";
import type { ResultCard, TestNodeResult } from "./engine/types";
import { downloadFlagged, ExportButton, FindingDetail } from "./FindingDetail";
import { RecordsDetail } from "./RecordsDetail";
import { Kpi, SeverityBadge } from "./ui";

export type FullState = "loading" | "ready" | "unavailable" | "error";

/** One screen skeleton for every test: KPIs, result cards by severity on the left, the selected card's detail on the right. */
export function TestResultScreen({ stored, full, fullState, onBack }: { stored: TestNodeResult; full: TestNodeResult | null; fullState: FullState; onBack: () => void }) {
  const template = getTemplate(stored.template);
  const cards = full?.cards ?? stored.cards;
  const found = cards.filter((c) => c.exceptions > 0);
  const clean = cards.filter((c) => c.exceptions === 0);
  const [selectedId, setSelectedId] = useState<string | null>(found[0]?.testId ?? cards[0]?.testId ?? null);
  const [showClean, setShowClean] = useState(false);
  const selected = cards.find((c) => c.testId === selectedId) ?? null;
  const complete = fullState === "ready" && full !== null;

  return (
    <div className="dq-result">
      <div className="dq-section-head">
        <div>
          <button className="dq-link" onClick={onBack}>← Run map</button>
          <h3>{template.title}</h3>
          <p className="muted dq-hint">{template.summary}</p>
        </div>
      </div>
      {fullState === "loading" ? <div className="dq-banner">Loading the source file to show every exception…</div> : null}
      {fullState === "unavailable" ? <div className="dq-banner">The source file of this run was deleted, so only the first exceptions per column are shown.</div> : null}
      {fullState === "error" ? <div className="dq-banner">The source file could not be loaded, so only the first exceptions per column are shown.</div> : null}

      <div className="dq-kpis">
        <Kpi label={cards.length === 1 && cards[0].subject === "Whole dataset" ? "Scope" : "Columns tested"} value={cards.length === 1 && cards[0].subject === "Whole dataset" ? "Whole file" : String(cards.length)} />
        <Kpi label="With findings" value={String(found.length)} tone={found.length ? "alert" : "ok"} />
        <Kpi label="Exceptions" value={found.reduce((n, c) => n + c.exceptions, 0).toLocaleString()} tone={found.length ? "alert" : "ok"} />
      </div>

      <div className="dq-result-layout">
        <div className="dq-result-list">
          {found.map((c) => <ResultCardButton key={c.testId} card={c} active={c.testId === selectedId} onSelect={() => setSelectedId(c.testId)} />)}
          {clean.length ? (
            <>
              <button className="dq-clean-toggle" onClick={() => setShowClean((v) => !v)} aria-expanded={showClean}>
                ✓ {clean.length} {clean.length === 1 ? "column" : "columns"} clean {showClean ? "▴" : "▾"}
              </button>
              {showClean ? clean.map((c) => <ResultCardButton key={c.testId} card={c} active={c.testId === selectedId} onSelect={() => setSelectedId(c.testId)} />) : null}
            </>
          ) : null}
        </div>
        <div className="dq-result-detail">
          {selected ? <CardDetail card={selected} detailView={template.detailView} complete={complete} /> : <p className="muted">Select a result.</p>}
        </div>
      </div>

      {stored.notes.length ? (
        <details className="dq-section">
          <summary>Not tested by this test ({stored.notes.length}) and why</summary>
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th>Column</th><th>Reason</th></tr></thead>
              <tbody>{stored.notes.map((note) => <tr key={note.subject}><td>{note.subject}</td><td>{note.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ResultCardButton({ card, active, onSelect }: { card: ResultCard; active: boolean; onSelect: () => void }) {
  return (
    <button className={`dq-finding dq-finding-${card.severity}${active ? " active" : ""}`} onClick={onSelect} aria-pressed={active}>
      <div className="dq-finding-head">
        <strong>{card.subject}</strong>
        <SeverityBadge severity={card.severity} />
      </div>
      <div className="dq-finding-count"><span>{card.exceptions.toLocaleString()}</span><small>{card.tested ? `${card.rate.toFixed(card.rate > 0 && card.rate < 0.1 ? 2 : 1)}% of ${card.tested.toLocaleString()}` : ""}</small></div>
      <div className="dq-finding-meta"><span>{card.summary}</span></div>
    </button>
  );
}

function CardDetail({ card, detailView, complete }: { card: ResultCard; detailView: "pattern" | "records"; complete: boolean }) {
  const finding = complete && detailView === "pattern" ? (card.detail as Finding | undefined) : undefined;
  return (
    <div className="dq-detail-panel">
      <div className="dq-section-head">
        <h3>{card.subject}</h3>
        {finding ? <ExportButton label="Export flagged" title={`Download the flagged records of ${card.subject} as CSV`} onClick={() => downloadFlagged([finding], `flagged-${card.subject}.csv`)} disabled={!finding.anomalyRecords.length} /> : null}
      </div>
      <p>{card.summary}</p>
      {card.facts ? (
        <dl className="dq-facts">{Object.entries(card.facts).map(([k, v]) => <FactRow key={k} label={k} value={v} />)}</dl>
      ) : null}
      {finding ? <FindingDetail key={card.testId} finding={finding} /> : <RecordsDetail key={card.testId} card={card} complete={complete} />}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string | number }) {
  return <><dt>{label}</dt><dd>{typeof value === "number" ? value.toLocaleString() : value}</dd></>;
}
