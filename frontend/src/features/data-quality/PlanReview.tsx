import { useState } from "react";
import { TYPE_LABEL } from "./engine/profile";
import { describeTest } from "./engine/runner";
import { TEMPLATES } from "./engine/templates/registry";
import type { DateFormat, DatasetProfile, Dimension, RunSettings, TestDefinition, TestSource } from "./engine/types";
import { rolesOf, type AppliedAiPlan } from "./engine/aiPlan";
import { PatternPlan } from "./PatternPlan";
import { RuleForm } from "./RuleForm";
import { FileIcon, Working } from "./ui";

const DIMENSIONS: { id: Dimension; title: string; text: string }[] = [
  { id: "completeness", title: "Completeness", text: "Is anything missing?" },
  { id: "validity", title: "Validity", text: "Does each value have the right type, format and range?" },
  { id: "uniqueness", title: "Uniqueness", text: "Is anything duplicated?" },
  { id: "accuracy", title: "Plausibility", text: "Does anything look unusual?" },
  { id: "consistency", title: "Consistency", text: "Do related columns agree?" }
];

const SOURCE_LABEL: Record<TestSource, string> = { standard: "Standard", discovered: "Discovered", auditor: "Added by you", ai: "AI suggestion" };

type Props = {
  fileName: string;
  headers: string[];
  profile: DatasetProfile;
  plan: TestDefinition[];
  settings: RunSettings;
  onPlanChange: (plan: TestDefinition[]) => void;
  onSettingsChange: (settings: RunSettings) => void;
  /** Removes a saved rule from the project (it stays out of this plan too). */
  onForgetRule: (id: string) => void;
  onRun: () => void;
  onCancel: () => void;
  ai: AiControls;
};

export type AiControls = { available: boolean; running: boolean; error: string; applied: AppliedAiPlan | null; onAsk: () => void; onDiscard: () => void };

/** The auditor reviews the proposed tests as plain sentences and can switch any of them off. */
export function PlanReview({ fileName, headers, profile, plan, settings, onPlanChange, onSettingsChange, onForgetRule, onRun, onCancel, ai }: Props) {
  const [addingRule, setAddingRule] = useState(false);
  const enabled = plan.filter((t) => t.enabled).length;
  const update = (id: string, patch: Partial<TestDefinition>) => onPlanChange(plan.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const setAll = (ids: string[], value: boolean) => onPlanChange(plan.map((t) => (ids.includes(t.id) ? { ...t, enabled: value } : t)));
  const remove = (id: string) => onPlanChange(plan.filter((t) => t.id !== id));
  const ambiguous = profile.columns.filter((c) => c.date && (c.date.alternatives.length || settings.dateFormats[c.name]));
  const notApplicable = TEMPLATES.filter((t) => t.id !== "rule" && !plan.some((d) => d.template === t.id));

  return (
    <div className="dq-plan">
      <div className="dq-section-head">
        <div>
          <h3>Review the test plan</h3>
          <p className="muted dq-hint">These standard tests were chosen from the kind of data in each column. Switch off anything you do not need, then run the tests.</p>
        </div>
        <div className="dq-file-bar">
          <span className="dq-file-chip" title={fileName}><FileIcon /><span className="dq-file-name">{fileName}</span><span className="dq-file-meta">{profile.rows.toLocaleString()} rows</span></span>
          <button className="dq-btn" onClick={onCancel}>Cancel</button>
          {ai.available && !ai.applied ? <button className="dq-btn" onClick={ai.onAsk} disabled={ai.running}>Ask AI to review the plan</button> : null}
          <button className="dq-btn dq-btn-primary" onClick={onRun} disabled={!enabled || ai.running}>Run {enabled} tests</button>
        </div>
      </div>
      {ai.running ? <Working>The AI is reviewing the columns and the proposed tests. This usually takes 10–60 seconds.</Working> : null}
      {ai.error ? <div className="error-banner">{ai.error} The standard plan below is unchanged.</div> : null}
      {ai.applied ? <AiReview applied={ai.applied} onDiscard={ai.onDiscard} /> : null}

      {ambiguous.length ? (
        <div className="dq-banner">
          <strong>Please confirm the date format.</strong>
          {ambiguous.map((c) => (
            <label key={c.name} className="dq-inline-field">
              {c.name}
              <select value={c.date!.format} onChange={(e) => onSettingsChange({ ...settings, dateFormats: { ...settings.dateFormats, [c.name]: e.target.value as DateFormat } })}>
                {[c.date!.format, ...c.date!.alternatives].map((f) => <option key={f} value={f}>{f} (e.g. {c.examples[0]})</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}

      <ColumnOverview profile={profile} roles={rolesOf(ai.applied)} />

      {DIMENSIONS.map((dimension) => {
        // The format / pattern test has its own panel, right after the other validity tests.
        const templates = TEMPLATES.filter((t) => t.dimension === dimension.id && t.id !== "validity.pattern" && plan.some((d) => d.template === t.id));
        const rules = dimension.id === "consistency";
        const patterns = dimension.id === "validity" && plan.some((d) => d.template === "validity.pattern")
          ? <PatternPlan key="patterns" headers={headers} profile={profile} plan={plan} settings={settings} onPlanChange={onPlanChange} onSettingsChange={onSettingsChange} />
          : null;
        if (!templates.length && !rules) return patterns;
        return [
          <section key={dimension.id} className="dq-plan-group">
            <div className="dq-section-head">
              <h4>{dimension.title} <span className="muted">— {dimension.text}</span></h4>
              {rules && !addingRule ? <button className="dq-btn" onClick={() => setAddingRule(true)}>Add rule</button> : null}
            </div>
            {rules && !templates.length && !addingRule ? <p className="muted dq-hint">No relationships between columns were found in this file. You can add your own rule, such as “the posting date should not be before the document date”.</p> : null}
            {rules && addingRule ? (
              <RuleForm profile={profile} existingIds={new Set(plan.map((t) => t.id))} onCancel={() => setAddingRule(false)}
                onAdd={(rule) => { onPlanChange([...plan, rule]); setAddingRule(false); }} />
            ) : null}
            {templates.map((template) => {
              const tests = plan.filter((d) => d.template === template.id);
              const on = tests.filter((t) => t.enabled).length;
              return (
                <details key={template.id} className="dq-plan-test">
                  <summary>
                    <span className="dq-plan-title">{template.title}</span>
                    <span className="muted">{template.summary}</span>
                    <span className="dq-plan-count">{on} of {tests.length} on</span>
                  </summary>
                  <div className="dq-plan-actions">
                    <button className="dq-link" onClick={() => setAll(tests.map((t) => t.id), true)}>All on</button>
                    <button className="dq-link" onClick={() => setAll(tests.map((t) => t.id), false)}>All off</button>
                  </div>
                  <ul className="dq-plan-list">
                    {tests.map((test) => (
                      <li key={test.id} className={test.enabled ? "" : "off"}>
                        <label className="dq-check">
                          <input type="checkbox" checked={test.enabled} onChange={(e) => update(test.id, { enabled: e.target.checked })} />
                          <span>{describeTest(test, profile)}</span>
                        </label>
                        <span className={`dq-source-chip dq-source-${test.savedAt ? "saved" : test.source}`}>{test.savedAt ? "Saved rule" : SOURCE_LABEL[test.source]}</span>
                        {test.aiNote ? <p className="dq-hint dq-ai-note">{test.aiNote}</p> : null}
                        <p className="muted dq-hint">
                          {test.reason}
                          {test.source === "auditor" && !test.savedAt ? <> <button className="dq-link" onClick={() => remove(test.id)}>Remove</button></> : null}
                          {test.savedAt ? <> <button className="dq-link" onClick={() => onForgetRule(test.id)} title="Remove this rule from the project's saved rules">Forget this saved rule</button></> : null}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </section>,
          patterns
        ];
      })}

      {notApplicable.length ? (
        <section className="dq-plan-group">
          <h4>Not applicable to this file</h4>
          <ul className="dq-notes">{notApplicable.map((t) => <li key={t.id}><strong>{t.title}</strong> — applies to {t.appliesTo.toLowerCase()}.</li>)}</ul>
        </section>
      ) : null}

      <AdvancedSettings settings={settings} onChange={onSettingsChange} />
    </div>
  );
}

function ColumnOverview({ profile, roles }: { profile: DatasetProfile; roles: Map<string, { role: string; meaning: string }> }) {
  return (
    <details className="dq-section">
      <summary>How the columns were read ({profile.columns.length})</summary>
      <div className="dq-table-wrap">
        <table className="dq-table">
          <thead><tr><th>Column</th>{roles.size ? <th>Meaning (AI)</th> : null}<th>Read as</th><th>Blank</th><th>Why</th><th>Examples</th></tr></thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                {roles.size ? <td>{roles.get(c.name)?.meaning || "—"}</td> : null}
                <td>{TYPE_LABEL[c.type]}{c.date ? ` (${c.date.format})` : ""}</td>
                <td>{c.blankPercent.toFixed(1)}%</td>
                <td>{c.typeReason}</td>
                <td className="dq-mono">{c.examples.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** What the AI review changed, before the auditor decides. Every change can be undone per test or all at once. */
function AiReview({ applied, onDiscard }: { applied: AppliedAiPlan; onDiscard: () => void }) {
  const r = applied.response;
  const changes = applied.switchedOff.length + applied.switchedOn.length + applied.addedRules.length;
  return (
    <section className="dq-ai-review">
      <div className="dq-section-head">
        <h4>AI review {r.demo ? <span className="dq-source-chip dq-source-ai">Demo — fixed rules, no AI model</span> : <span className="muted">· {r.provider}{r.model ? ` · ${r.model}` : ""}</span>}</h4>
        <button className="dq-link" onClick={onDiscard}>Discard AI suggestions</button>
      </div>
      {r.summary ? <p>{r.summary}</p> : null}
      <p className="muted dq-hint">
        {changes ? `${changes} change${changes === 1 ? "" : "s"} applied below and marked “AI”: ${applied.switchedOff.length} switched off, ${applied.switchedOn.length} switched on, ${applied.addedRules.length} rule${applied.addedRules.length === 1 ? "" : "s"} added.` : "The AI proposed no changes to the plan."}
        {" "}You can still switch any test on or off. The AI saw the column profile, the proposed tests, the audit context and {r.sample_rows_sent} sample rows.
      </p>
      {r.not_testable.length ? (
        <div>
          <strong>Ideas that cannot be tested here (consider them for fieldwork)</strong>
          <ul className="dq-notes">{r.not_testable.map((c, i) => <li key={i}>{c.idea}{c.reason ? ` — ${c.reason}` : ""}</li>)}</ul>
        </div>
      ) : null}
      {applied.rejectedRules.length ? (
        <details>
          <summary className="muted">{applied.rejectedRules.length} AI proposal{applied.rejectedRules.length === 1 ? " was" : "s were"} not used because {applied.rejectedRules.length === 1 ? "it does" : "they do"} not fit this file</summary>
          <ul className="dq-notes">{applied.rejectedRules.map((c, i) => <li key={i}>{c.problem}{c.reason ? ` (${c.reason})` : ""}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function AdvancedSettings({ settings, onChange }: { settings: RunSettings; onChange: (settings: RunSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  type NumberKey = "blankThresholdPercent" | "outlierFactor" | "discoveryMinHoldPercent" | "ruleFindingMaxPercent" | "ruleUncertainMaxPercent";
  const number = (key: NumberKey, min: number, max: number) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: Math.min(max, Math.max(min, Number(value) || 0)) }));
  const keys = ["blankThresholdPercent", "outlierFactor", "discoveryMinHoldPercent", "ruleFindingMaxPercent", "ruleUncertainMaxPercent"] as const;
  const invalid = draft.ruleFindingMaxPercent > draft.ruleUncertainMaxPercent;
  const changed = keys.some((k) => draft[k] !== settings[k]);
  const apply = () => onChange({ ...settings, ...Object.fromEntries(keys.map((k) => [k, draft[k]])) });
  return (
    <details className="dq-section">
      <summary>Advanced settings (optional)</summary>
      <div className="dq-advanced">
        <label><span className="dq-label">Blank tolerance (% of a column)</span><input type="number" min={0} max={100} step={0.5} value={draft.blankThresholdPercent} onChange={(e) => number("blankThresholdPercent", 0, 100)(e.target.value)} /></label>
        <label><span className="dq-label">Unusual amounts (× interquartile range)</span><input type="number" min={1} max={10} step={0.5} value={draft.outlierFactor} onChange={(e) => number("outlierFactor", 1, 10)(e.target.value)} /></label>
      </div>
      <div className="dq-advanced">
        <label><span className="dq-label">Propose a relationship when it holds for (%)</span><input type="number" min={50} max={100} step={0.5} value={draft.discoveryMinHoldPercent} onChange={(e) => number("discoveryMinHoldPercent", 50, 100)(e.target.value)} /></label>
        <label><span className="dq-label">Rule exceptions are findings up to (% of rows)</span><input type="number" min={0} max={100} step={0.5} value={draft.ruleFindingMaxPercent} onChange={(e) => number("ruleFindingMaxPercent", 0, 100)(e.target.value)} /></label>
        <label><span className="dq-label">Rule is to be confirmed up to (% of rows)</span><input type="number" min={0} max={100} step={0.5} value={draft.ruleUncertainMaxPercent} onChange={(e) => number("ruleUncertainMaxPercent", 0, 100)(e.target.value)} /></label>
        <button className="dq-btn" onClick={apply} disabled={!changed || invalid}>Apply</button>
      </div>
      {invalid ? <p className="dq-hint dq-error-text">The “findings” limit cannot be higher than the “to be confirmed” limit.</p> : null}
      <p className="muted dq-hint">Applying keeps the tests you switched off and the rules you added. The format / pattern settings are in its own panel above. Above the “to be confirmed” limit a rule is reported as not holding.</p>
    </details>
  );
}
