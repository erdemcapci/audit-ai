import { useState } from "react";
import { TYPE_LABEL } from "./engine/profile";
import { describeTest } from "./engine/runner";
import { TEMPLATES } from "./engine/templates/registry";
import type { DateFormat, DatasetProfile, Dimension, RunSettings, TestDefinition, TestSource } from "./engine/types";
import { RuleForm } from "./RuleForm";
import { FileIcon } from "./ui";

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
};

/** The auditor reviews the proposed tests as plain sentences and can switch any of them off. */
export function PlanReview({ fileName, headers, profile, plan, settings, onPlanChange, onSettingsChange, onForgetRule, onRun, onCancel }: Props) {
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
          <button className="dq-btn dq-btn-primary" onClick={onRun} disabled={!enabled}>Run {enabled} tests</button>
        </div>
      </div>

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

      <ColumnOverview profile={profile} />

      {DIMENSIONS.map((dimension) => {
        const templates = TEMPLATES.filter((t) => t.dimension === dimension.id && plan.some((d) => d.template === t.id));
        const rules = dimension.id === "consistency";
        if (!templates.length && !rules) return null;
        return (
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
                <details key={template.id} className="dq-plan-test" open={tests.length <= 3 || template.id === "rule"}>
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
                        <p className="muted dq-hint">
                          {test.reason}
                          {test.source === "auditor" && !test.savedAt ? <> <button className="dq-link" onClick={() => remove(test.id)}>Remove</button></> : null}
                          {test.savedAt ? <> <button className="dq-link" onClick={() => onForgetRule(test.id)} title="Remove this rule from the project's saved rules">Forget this saved rule</button></> : null}
                        </p>
                        {test.template === "validity.pattern" ? (
                          <label className="dq-inline-field">
                            Compare within
                            <select value={String((test.params as { group: string }).group)} onChange={(e) => update(test.id, { params: { ...test.params, group: e.target.value } })}>
                              <option value="auto">Automatic{groupLabel(profile, test.subject)}</option>
                              <option value="none">All records (no grouping)</option>
                              {headers.filter((h) => h !== test.subject).map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </label>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </section>
        );
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

function groupLabel(profile: DatasetProfile, column: string) {
  const grouping = profile.patterns.find((p) => p.column === column)?.grouping;
  return grouping ? ` (${grouping.column})` : " (none)";
}

function ColumnOverview({ profile }: { profile: DatasetProfile }) {
  return (
    <details className="dq-section">
      <summary>How the columns were read ({profile.columns.length})</summary>
      <div className="dq-table-wrap">
        <table className="dq-table">
          <thead><tr><th>Column</th><th>Read as</th><th>Blank</th><th>Why</th><th>Examples</th></tr></thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
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

function AdvancedSettings({ settings, onChange }: { settings: RunSettings; onChange: (settings: RunSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  type NumberKey = "blankThresholdPercent" | "patternThresholdPercent" | "outlierFactor" | "discoveryMinHoldPercent" | "ruleFindingMaxPercent" | "ruleUncertainMaxPercent";
  const number = (key: NumberKey, min: number, max: number) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: Math.min(max, Math.max(min, Number(value) || 0)) }));
  const keys = ["blankThresholdPercent", "patternThresholdPercent", "outlierFactor", "keepSpecial", "discoveryMinHoldPercent", "ruleFindingMaxPercent", "ruleUncertainMaxPercent"] as const;
  const invalid = draft.ruleFindingMaxPercent > draft.ruleUncertainMaxPercent;
  const changed = keys.some((k) => draft[k] !== settings[k]);
  const apply = () => onChange({ ...settings, ...Object.fromEntries(keys.map((k) => [k, draft[k]])) });
  return (
    <details className="dq-section">
      <summary>Advanced settings (optional)</summary>
      <div className="dq-advanced">
        <label><span className="dq-label">Blank tolerance (% of a column)</span><input type="number" min={0} max={100} step={0.5} value={draft.blankThresholdPercent} onChange={(e) => number("blankThresholdPercent", 0, 100)(e.target.value)} /></label>
        <label><span className="dq-label">Rare-pattern threshold (% of group)</span><input type="number" min={0} max={50} step={0.5} value={draft.patternThresholdPercent} onChange={(e) => number("patternThresholdPercent", 0, 50)(e.target.value)} /></label>
        <label><span className="dq-label">Unusual amounts (× interquartile range)</span><input type="number" min={1} max={10} step={0.5} value={draft.outlierFactor} onChange={(e) => number("outlierFactor", 1, 10)(e.target.value)} /></label>
        <label className="dq-check"><input type="checkbox" checked={draft.keepSpecial} onChange={(e) => setDraft((d) => ({ ...d, keepSpecial: e.target.checked }))} /> Keep special characters in patterns (otherwise “S”)</label>
      </div>
      <div className="dq-advanced">
        <label><span className="dq-label">Propose a relationship when it holds for (%)</span><input type="number" min={50} max={100} step={0.5} value={draft.discoveryMinHoldPercent} onChange={(e) => number("discoveryMinHoldPercent", 50, 100)(e.target.value)} /></label>
        <label><span className="dq-label">Rule exceptions are findings up to (% of rows)</span><input type="number" min={0} max={100} step={0.5} value={draft.ruleFindingMaxPercent} onChange={(e) => number("ruleFindingMaxPercent", 0, 100)(e.target.value)} /></label>
        <label><span className="dq-label">Rule is to be confirmed up to (% of rows)</span><input type="number" min={0} max={100} step={0.5} value={draft.ruleUncertainMaxPercent} onChange={(e) => number("ruleUncertainMaxPercent", 0, 100)(e.target.value)} /></label>
        <button className="dq-btn" onClick={apply} disabled={!changed || invalid}>Apply</button>
      </div>
      {invalid ? <p className="dq-hint dq-error-text">The “findings” limit cannot be higher than the “to be confirmed” limit.</p> : null}
      <p className="muted dq-hint">Applying keeps the tests you switched off and the rules you added. Above the “to be confirmed” limit a rule is reported as not holding.</p>
    </details>
  );
}
