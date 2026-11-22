import { useState } from "react";
import { Badge } from "../../components/Badge";
import { DistributionDetail } from "./DistributionDetail";
import type { Finding } from "./engine/patterns";
import { AI_ACTION_LABEL, type AiCardInterpretation } from "./engine/interpretation";
import { isFinding } from "./engine/runner";
import type { Distribution } from "./engine/templates/accuracy";
import { getTemplate } from "./engine/templates/registry";
import type { ResultCard, TestNodeResult } from "./engine/types";
import { downloadFlagged, ExportButton, FindingDetail } from "./FindingDetail";
import { RecordsDetail } from "./RecordsDetail";
import { Kpi, SeverityBadge, Working } from "./ui";

export type FullState = "loading" | "ready" | "unavailable" | "error";

export type RuleSaving = { savedIds: Set<string>; onSave: (testId: string) => void };

/** One screen skeleton for every test: KPIs, result cards by severity on the left, the selected card's detail on the right. */
export function TestResultScreen({ stored, full, fullState, onBack, ruleSaving, interpretations }: { stored: TestNodeResult; full: TestNodeResult | null; fullState: FullState; onBack: () => void; ruleSaving?: RuleSaving; interpretations?: Map<string, AiCardInterpretation> }) {
  const template = getTemplate(stored.template);
  const cards = full?.cards ?? stored.cards;
  const found = cards.filter(isFinding);
  const toConfirm = cards.filter((c) => c.classification === "uncertain");
  const notHeld = cards.filter((c) => c.classification === "rule_did_not_hold");
  const clean = cards.filter((c) => c.exceptions === 0);
  const [selectedId, setSelectedId] = useState<string | null>(found[0]?.testId ?? toConfirm[0]?.testId ?? cards[0]?.testId ?? null);
  const [showClean, setShowClean] = useState(false);
  const selected = cards.find((c) => c.testId === selectedId) ?? null;
  const complete = fullState === "ready" && full !== null;
  const isRules = stored.template === "rule";
  const unit = isRules ? "rule" : "column";
  const wholeFile = cards.length === 1 && cards[0].subject === "Whole dataset";
  const button = (c: ResultCard) => <ResultCardButton key={c.testId} card={c} ai={interpretations?.get(c.testId)} active={c.testId === selectedId} onSelect={() => setSelectedId(c.testId)} />;

  return (
    <div className="dq-result">
      <div className="dq-section-head">
        <div>
          <button className="dq-link" onClick={onBack}>← Run map</button>
          <h3>{template.title}</h3>
          <p className="muted dq-hint">{template.summary}</p>
        </div>
      </div>
      {fullState === "loading" ? <Working>Loading the source file to show every exception…</Working> : null}
      {fullState === "unavailable" ? <div className="dq-banner">The source file of this run was deleted, so only the first exceptions per {unit} are shown.</div> : null}
      {fullState === "error" ? <div className="dq-banner">The source file could not be loaded, so only the first exceptions per {unit} are shown.</div> : null}

      <div className="dq-kpis">
        <Kpi label={wholeFile ? "Scope" : isRules ? "Rules tested" : "Columns tested"} value={wholeFile ? "Whole file" : String(cards.length)} />
        <Kpi label="With findings" value={String(found.length)} tone={found.length ? "alert" : "ok"} />
        <Kpi label="Exceptions" value={found.reduce((n, c) => n + c.exceptions, 0).toLocaleString()} tone={found.length ? "alert" : "ok"} />
        {isRules ? <Kpi label="To confirm" value={String(toConfirm.length)} /> : null}
      </div>

      <div className="dq-result-layout">
        <div className="dq-result-list">
          {found.map(button)}
          {toConfirm.length ? <><h4 className="dq-list-group">To confirm</h4><p className="muted dq-hint">Broken by too many rows to be simple exceptions. Does the rule really apply?</p>{toConfirm.map(button)}</> : null}
          {notHeld.length ? <><h4 className="dq-list-group">Did not hold</h4><p className="muted dq-hint">Not findings: the data does not follow these rules.</p>{notHeld.map(button)}</> : null}
          {clean.length ? (
            <>
              <button className="dq-clean-toggle" onClick={() => setShowClean((v) => !v)} aria-expanded={showClean}>
                ✓ {clean.length} {clean.length === 1 ? unit : `${unit}s`} {isRules ? "hold" : "clean"} {showClean ? "▴" : "▾"}
              </button>
              {showClean ? clean.map(button) : null}
            </>
          ) : null}
          {!cards.length ? <p className="muted">No {unit}s were tested.</p> : null}
        </div>
        <div className="dq-result-detail">
          {selected ? <CardDetail card={selected} ai={interpretations?.get(selected.testId)} detailView={template.detailView} complete={complete} ruleSaving={isRules ? ruleSaving : undefined} /> : <p className="muted">Select a result.</p>}
        </div>
      </div>

      {stored.notes.length ? (
        <details className="dq-section">
          <summary>Not tested by this test ({stored.notes.length}) and why</summary>
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th>{isRules ? "Rule" : "Column"}</th><th>Reason</th></tr></thead>
              <tbody>{stored.notes.map((note) => <tr key={note.subject}><td>{note.subject}</td><td>{note.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

const CLASSIFICATION_BADGE = { uncertain: { text: "To confirm", tone: "amber" }, rule_did_not_hold: { text: "Did not hold", tone: "neutral" } } as const;

function StatusBadge({ card }: { card: ResultCard }) {
  if (card.classification === "uncertain" || card.classification === "rule_did_not_hold") {
    const badge = CLASSIFICATION_BADGE[card.classification];
    return <Badge tone={badge.tone}>{badge.text}</Badge>;
  }
  return <SeverityBadge severity={card.severity} />;
}

function ResultCardButton({ card, ai, active, onSelect }: { card: ResultCard; ai?: AiCardInterpretation; active: boolean; onSelect: () => void }) {
  const tone = isFinding(card) || card.exceptions === 0 ? card.severity : "muted";
  return (
    <button className={`dq-finding dq-finding-${tone}${active ? " active" : ""}`} onClick={onSelect} aria-pressed={active}>
      <div className="dq-finding-head">
        <strong className="dq-finding-subject" title={card.subject}>{card.subject}</strong>
        <span className="dq-badges">
          <StatusBadge card={card} />
          {ai && ai.severity !== card.severity ? <span className="dq-ai-badge" title={ai.severity_reason}>AI: {ai.severity}</span> : null}
        </span>
      </div>
      <div className="dq-finding-count"><span>{card.exceptions.toLocaleString()}</span><small>{card.tested ? `${card.rate.toFixed(card.rate > 0 && card.rate < 0.1 ? 2 : 1)}% of ${card.tested.toLocaleString()}` : ""}</small></div>
      <div className="dq-finding-meta"><span>{card.summary}</span></div>
    </button>
  );
}

function CardDetail({ card, ai, detailView, complete, ruleSaving }: { card: ResultCard; ai?: AiCardInterpretation; detailView: "pattern" | "records" | "distribution"; complete: boolean; ruleSaving?: RuleSaving }) {
  const finding = complete && detailView === "pattern" ? (card.detail as Finding | undefined) : undefined;
  const distribution = complete && detailView === "distribution" ? (card.detail as Distribution | undefined) : undefined;
  const saved = ruleSaving?.savedIds.has(card.testId);
  return (
    <div className="dq-detail-panel">
      <div className="dq-section-head">
        <h3 className="dq-finding-subject">{card.subject}</h3>
        <div className="dq-file-bar">
          {ruleSaving ? (
            <button className="dq-btn" onClick={() => ruleSaving.onSave(card.testId)} disabled={saved} title="Propose this rule again in later runs of this audit">
              {saved ? "Saved to project" : "Save rule to project"}
            </button>
          ) : null}
          {finding ? <ExportButton label="Export flagged" title={`Download the flagged records of ${card.subject} as CSV`} onClick={() => downloadFlagged([finding], `flagged-${card.subject}.csv`)} disabled={!finding.anomalyRecords.length} /> : null}
        </div>
      </div>
      <p>{card.summary}</p>
      {ai ? <AiNote ai={ai} codeSeverity={card.severity} /> : null}
      {card.facts ? (
        <dl className="dq-facts">{Object.entries(card.facts).map(([k, v]) => <FactRow key={k} label={k} value={v} />)}</dl>
      ) : null}
      {distribution && distribution.bins?.length ? <DistributionDetail distribution={distribution} column={card.subject} /> : null}
      {finding ? <FindingDetail key={card.testId} finding={finding} /> : <RecordsDetail key={card.testId} card={card} complete={complete} />}
    </div>
  );
}

/** The AI's reading of one result, next to (never instead of) the test's own numbers and severity. */
function AiNote({ ai, codeSeverity }: { ai: AiCardInterpretation; codeSeverity: string }) {
  return (
    <div className="dq-ai-review dq-ai-card">
      <strong>AI interpretation</strong>
      {ai.meaning ? <p>{ai.meaning}</p> : null}
      <p><strong>{AI_ACTION_LABEL[ai.action]}:</strong> {ai.action_text}</p>
      <p className="muted dq-hint">
        AI severity: {ai.severity}{ai.severity !== codeSeverity ? ` (the test says ${codeSeverity})` : ""}{ai.severity_reason ? ` — ${ai.severity_reason}` : ""}
      </p>
      {ai.unverified_numbers.length ? <p className="dq-hint dq-error-text">Check this note: it uses numbers that are not in the results ({ai.unverified_numbers.join(", ")}).</p> : null}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string | number }) {
  return <><dt>{label}</dt><dd>{typeof value === "number" ? value.toLocaleString() : value}</dd></>;
}
