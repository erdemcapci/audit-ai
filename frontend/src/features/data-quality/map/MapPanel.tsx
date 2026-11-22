import { TYPE_LABEL } from "../engine/profile";
import { formatRunDate } from "../engine/report";
import type { AppliedAiPlan } from "../engine/aiPlan";
import { ruleId, ruleLabel } from "../engine/rules";
import { isFinding, VERDICT_LABEL } from "../engine/runner";
import type { RunRecord } from "../engine/session";
import { getTemplate } from "../engine/templates/registry";
import { withDefaults, type PlanChange, type TemplateId, type TestNodeResult } from "../engine/types";
import { formatBytes, SeverityBadge } from "../ui";

const n = (value: number) => value.toLocaleString("en-US");
const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

type Props = {
  nodeId: string;
  record: RunRecord;
  tests: TestNodeResult[];
  onClose: () => void;
  onViewTest: (template: TemplateId) => void;
  onViewFile: () => void;
  onViewReport: () => void;
};

/** Side panel for a run-map node: what happened in that step, from the run log. */
export function MapPanel({ nodeId, record, tests, onClose, onViewTest, onViewFile, onViewReport }: Props) {
  const step = record.steps.find((s) => s.id === nodeId);
  return (
    <aside className="dq-map-panel">
      <div className="dq-section-head">
        <h3>{title(nodeId, record)}</h3>
        <button className="dq-btn" onClick={onClose} aria-label="Close panel">Close</button>
      </div>
      {step ? <p className="muted dq-hint">{formatRunDate(step.startedAt)}{step.durationMs ? ` · took ${seconds(step.durationMs)}` : ""}</p> : null}
      {nodeId === "source" ? <SourcePanel record={record} onViewFile={onViewFile} /> : null}
      {nodeId === "profile" ? <ProfilePanel record={record} /> : null}
      {nodeId === "discovery" ? <DiscoveryPanel record={record} /> : null}
      {nodeId === "ai" && record.ai_plan ? <AiPanel ai={record.ai_plan} /> : null}
      {nodeId === "plan" ? <PlanPanel record={record} changes={(step?.detail.changes as PlanChange[] | undefined) ?? []} /> : null}
      {nodeId.startsWith("test:") ? <TestPanel test={tests.find((t) => `test:${t.template}` === nodeId)} onView={onViewTest} /> : null}
      {nodeId === "exceptions" ? <ExceptionsPanel record={record} tests={tests} onView={onViewTest} /> : null}
      {nodeId === "result" ? (
        <div className="dq-panel-body">
          <p><strong>{VERDICT_LABEL[record.verdict]}</strong> — {n(record.totals.tests)} tests, {n(record.totals.findings)} with findings ({n(record.totals.high)} high, {n(record.totals.medium)} medium, {n(record.totals.low)} low).</p>
          <p className="muted dq-hint">The verdict grades the findings. Whether the data is fit for your audit work remains your judgement.</p>
          <button className="dq-btn dq-btn-primary" onClick={onViewReport}>View report</button>
        </div>
      ) : null}
    </aside>
  );
}

function title(nodeId: string, record: RunRecord) {
  if (nodeId === "source") return "Source file";
  if (nodeId === "profile") return "Column profile";
  if (nodeId === "discovery") return "Relationship discovery";
  if (nodeId === "ai") return "AI test plan";
  if (nodeId === "plan") return "Test plan";
  if (nodeId === "exceptions") return "Exceptions";
  if (nodeId === "result") return "Result";
  return getTemplate(nodeId.slice(5) as TemplateId).title || record.source.name;
}

function SourcePanel({ record, onViewFile }: { record: RunRecord; onViewFile: () => void }) {
  const s = record.source;
  return (
    <div className="dq-panel-body">
      <dl className="dq-facts">
        <dt>File</dt><dd>{s.name}</dd>
        <dt>Size</dt><dd>{formatBytes(s.size)}</dd>
        <dt>Rows</dt><dd>{n(s.rows)}</dd>
        <dt>Columns</dt><dd>{n(s.columns)}</dd>
        <dt>Stored copy</dt><dd>{s.stored ? "Yes" : "Deleted — results are kept"}</dd>
      </dl>
      <button className="dq-btn" onClick={onViewFile} disabled={!s.stored}>View file</button>
    </div>
  );
}

function ProfilePanel({ record }: { record: RunRecord }) {
  return (
    <div className="dq-panel-body">
      <p className="muted dq-hint">How each column was read. The tests that apply follow from this.</p>
      <div className="dq-table-wrap">
        <table className="dq-table">
          <thead><tr><th>Column</th><th>Read as</th><th>Blank</th></tr></thead>
          <tbody>
            {record.profile.columns.map((c) => (
              <tr key={c.name} title={c.typeReason}><td>{c.name}</td><td>{TYPE_LABEL[c.type]}{c.date ? ` (${c.date.format})` : ""}</td><td>{c.blankPercent.toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiscoveryPanel({ record }: { record: RunRecord }) {
  const relationships = record.profile.relationships ?? [];
  const settings = withDefaults(record.settings);
  const inPlan = new Map(record.plan.map((t) => [t.id, t.enabled]));
  return (
    <div className="dq-panel-body">
      <p>The code looked for relationships between columns in a sample of the rows. Each one that held for at least {settings.discoveryMinHoldPercent}% of the rows it applies to was proposed as a rule.</p>
      {record.profile.discoveryNote ? <p className="muted dq-hint">{record.profile.discoveryNote}</p> : null}
      {relationships.length ? (
        <ul className="dq-panel-cards">
          {relationships.map((r) => {
            const enabled = inPlan.get(ruleId(r.rule));
            return (
              <li key={ruleId(r.rule)}>
                <strong>{ruleLabel(r.rule)}</strong>
                <span className="muted">Holds for {(r.holdRate * 100).toFixed(1)}% of {n(r.checked)} sampled rows · {enabled === undefined ? "not in the plan" : enabled ? "tested" : "switched off"}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted dq-hint">No relationship between columns was strong enough to propose as a rule.</p>}
    </div>
  );
}

/** What the AI review saw and proposed, and what became of each proposal. */
function AiPanel({ ai }: { ai: AppliedAiPlan }) {
  const r = ai.response;
  const roles = r.columns.filter((c) => c.role !== "other" || c.meaning);
  return (
    <div className="dq-panel-body">
      {r.summary ? <p>{r.summary}</p> : null}
      <dl className="dq-facts">
        <dt>Model</dt><dd>{r.demo ? "Demo mode — fixed rules, no AI model" : `${r.provider}${r.model ? ` · ${r.model}` : ""}`}</dd>
        <dt>Sent to the AI</dt><dd>Column profile, proposed tests, audit context and {n(r.sample_rows_sent)} sample rows (≈ {n(r.estimated_tokens)} tokens)</dd>
        {r.log_run_id ? <><dt>Log</dt><dd>Agent Logs · {r.log_run_id}</dd></> : null}
      </dl>
      <h4>Changes to the plan</h4>
      {ai.switchedOff.length || ai.switchedOn.length || ai.addedRules.length ? (
        <ul className="dq-panel-cards">
          {ai.switchedOff.map((c) => <li key={`off-${c.testId}`}><strong>Switched off: {c.subject}</strong><span className="muted">{c.reason}</span></li>)}
          {ai.switchedOn.map((c) => <li key={`on-${c.testId}`}><strong>Switched on: {c.subject}</strong><span className="muted">{c.reason}</span></li>)}
          {ai.addedRules.map((c) => <li key={`add-${c.testId}`}><strong>Rule added: {c.subject}</strong><span className="muted">{c.reason}</span></li>)}
        </ul>
      ) : <p className="muted dq-hint">None proposed.</p>}
      {ai.rejectedRules.length ? (
        <>
          <h4>Proposals not used</h4>
          <ul className="dq-panel-cards">{ai.rejectedRules.map((c, i) => <li key={i}><strong>{c.problem}</strong><span className="muted">{c.reason}</span></li>)}</ul>
        </>
      ) : null}
      {r.not_testable.length ? (
        <>
          <h4>Ideas for fieldwork</h4>
          <ul className="dq-panel-cards">{r.not_testable.map((c, i) => <li key={i}><strong>{c.idea}</strong>{c.reason ? <span className="muted">{c.reason}</span> : null}</li>)}</ul>
        </>
      ) : null}
      {roles.length ? (
        <>
          <h4>Column meanings</h4>
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th>Column</th><th>Meaning</th><th>Role</th></tr></thead>
              <tbody>{roles.map((c) => <tr key={c.column}><td>{c.column}</td><td>{c.meaning}</td><td className="dq-mono">{c.role}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PlanPanel({ record, changes }: { record: RunRecord; changes: PlanChange[] }) {
  const enabled = record.plan.filter((t) => t.enabled).length;
  const bySource = (source: string) => record.plan.filter((t) => t.enabled && t.source === source).length;
  const settings = withDefaults(record.settings);
  return (
    <div className="dq-panel-body">
      <p>{n(enabled)} of {n(record.plan.length)} proposed tests ran: {n(bySource("standard"))} standard, {n(bySource("discovered"))} discovered rules, {n(bySource("auditor"))} added by you{bySource("ai") ? `, ${n(bySource("ai"))} AI suggestions` : ""}{record.plan.some((t) => t.savedAt) ? `, ${n(record.plan.filter((t) => t.enabled && t.savedAt).length)} saved project rules` : ""}.{record.ai_used ? " The plan was reviewed by AI before you approved it." : " No AI was used."}</p>
      <h4>Your changes</h4>
      {changes.length ? (
        <ul className="dq-notes">{changes.map((c) => <li key={c.testId}>{getTemplate(c.template).title} — {c.subject}: {c.change === "switched_off" ? "switched off" : c.change === "switched_on" ? "switched on" : `changed (${c.detail})`}</li>)}</ul>
      ) : <p className="muted dq-hint">The standard plan was run as proposed.</p>}
      <h4>Settings</h4>
      <ul className="dq-notes">
        <li>Blank tolerance: {settings.blankThresholdPercent}%</li>
        <li>Rare-pattern threshold: {settings.patternThresholdPercent}%</li>
        <li>Unusual amounts: {settings.outlierFactor} × interquartile range</li>
        <li>Rules: findings up to {settings.ruleFindingMaxPercent}% of rows, to confirm up to {settings.ruleUncertainMaxPercent}%</li>
      </ul>
    </div>
  );
}

function TestPanel({ test, onView }: { test?: TestNodeResult; onView: (template: TemplateId) => void }) {
  if (!test) return null;
  const template = getTemplate(test.template);
  if (test.status !== "done") {
    return (
      <div className="dq-panel-body">
        <p>{template.summary}</p>
        <p className="muted dq-hint">{test.status === "switched_off" ? "Switched off in the test plan." : `Not applicable: it applies to ${template.appliesTo.toLowerCase()}, and this file has none.`}</p>
      </div>
    );
  }
  const found = test.cards.filter(isFinding);
  const toConfirm = test.cards.filter((c) => c.classification === "uncertain");
  const notHeld = test.cards.filter((c) => c.classification === "rule_did_not_hold");
  const clean = test.cards.filter((c) => c.exceptions === 0).length;
  const unit = test.template === "rule" ? "rule" : "column";
  return (
    <div className="dq-panel-body">
      <p>{template.summary}</p>
      <ul className="dq-panel-cards">
        {found.map((c) => <li key={c.testId}><SeverityBadge severity={c.severity} /> <strong>{c.subject}</strong> — {c.summary}</li>)}
        {toConfirm.map((c) => <li key={c.testId}><strong>To confirm: {c.subject}</strong> — {c.summary}</li>)}
        {notHeld.length ? <li className="muted">{n(notHeld.length)} rule{notHeld.length === 1 ? "" : "s"} did not hold</li> : null}
        {clean ? <li className="muted">{n(clean)} {unit}{clean === 1 ? "" : "s"} {unit === "rule" ? "hold" : "clean"}</li> : null}
      </ul>
      <button className="dq-btn dq-btn-primary" onClick={() => onView(test.template)}>View details</button>
    </div>
  );
}

function ExceptionsPanel({ record, tests, onView }: { record: RunRecord; tests: TestNodeResult[]; onView: (template: TemplateId) => void }) {
  const found = tests.flatMap((t) => t.cards.filter(isFinding).map((c) => ({ t, c })));
  const rank = { high: 0, medium: 1, low: 2, clean: 3 };
  found.sort((a, b) => rank[a.c.severity] - rank[b.c.severity] || b.c.rate - a.c.rate);
  return (
    <div className="dq-panel-body">
      <p>{n(record.totals.findings)} findings affecting {n(record.totals.exceptions)} records.</p>
      <ul className="dq-panel-cards">
        {found.map(({ t, c }) => (
          <li key={c.testId}>
            <button className="dq-link" onClick={() => onView(t.template)}><SeverityBadge severity={c.severity} /> <strong>{t.title}</strong> — {c.subject}</button>
            <span className="muted">{c.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
