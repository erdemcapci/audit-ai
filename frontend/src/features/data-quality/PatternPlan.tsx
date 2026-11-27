import { useState } from "react";
import { patternCoveredElsewhere, VERDICT_TEXT } from "./engine/templates/pattern";
import type { DatasetProfile, RunSettings, TestDefinition } from "./engine/types";

type Props = {
  headers: string[];
  profile: DatasetProfile;
  plan: TestDefinition[];
  settings: RunSettings;
  onPlanChange: (plan: TestDefinition[]) => void;
  onSettingsChange: (settings: RunSettings) => void;
};

/**
 * The format / pattern test has its own panel: every column with its automatic assessment, whether to
 * analyse it, and what to compare it within (for example tax numbers within each country).
 */
export function PatternPlan({ headers, profile, plan, settings, onPlanChange, onSettingsChange }: Props) {
  const tests = new Map(plan.filter((t) => t.template === "validity.pattern").map((t) => [t.subject, t]));
  const on = [...tests.values()].filter((t) => t.enabled).length;
  const update = (id: string, patch: Partial<TestDefinition>) => onPlanChange(plan.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <section className="dq-plan-group">
      <h4>Format / pattern <span className="muted">— Do identifiers and codes follow their usual format?</span></h4>
      <details className="dq-plan-test">
        <summary>
          <span className="dq-plan-title">Character patterns</span>
          <span className="muted">Each value is turned into a pattern (letters, digits, special characters); rare patterns are flagged, such as a tax number with a missing digit.</span>
          <span className="dq-plan-count">{on} of {profile.patterns.length} columns</span>
        </summary>
        <div className="dq-table-wrap dq-pattern-table">
          <table className="dq-table">
            <thead><tr><th>Column</th><th>Automatic assessment</th><th>Analyse</th><th>Compare within</th><th>Example values</th></tr></thead>
            <tbody>
              {profile.patterns.map((p) => {
                const test = tests.get(p.column);
                const elsewhere = patternCoveredElsewhere(profile, p.column);
                const auto = p.verdict === "suitable";
                return (
                  <tr key={p.column} className={test?.enabled ? "" : "dq-row-off"}>
                    <td>{p.column}</td>
                    <td>
                      {elsewhere ? <span className="dq-chip dq-chip-unsuitable">Other test</span> : <span className={`dq-chip dq-chip-${p.verdict}`}>{VERDICT_TEXT[p.verdict]}</span>}
                      <p className="muted dq-hint">{elsewhere || p.reasons.join(" ")}</p>
                      {test?.aiNote ? <p className="dq-hint dq-ai-note">{test.aiNote}</p> : null}
                    </td>
                    <td>
                      {test ? (
                        <select value={test.enabled === auto ? "auto" : test.enabled ? "yes" : "no"} aria-label={`Analyse ${p.column}`}
                          onChange={(e) => update(test.id, { enabled: e.target.value === "auto" ? auto : e.target.value === "yes" })}>
                          <option value="auto">Automatic ({auto ? "yes" : "no"})</option>
                          {auto ? <option value="no">Never</option> : <option value="yes">Always</option>}
                        </select>
                      ) : <span className="muted">Checked by “Wrong data type”</span>}
                    </td>
                    <td>
                      {test ? (
                        <select value={String((test.params as { group: string }).group)} aria-label={`Compare ${p.column} within`}
                          onChange={(e) => update(test.id, { params: { ...test.params, group: e.target.value } })}>
                          <option value="auto">Automatic ({p.grouping ? p.grouping.column : "all records"})</option>
                          <option value="none">All records (no grouping)</option>
                          {headers.filter((h) => h !== p.column).map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="dq-mono">{p.examples.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PatternSettings settings={settings} onChange={onSettingsChange} />
      </details>
    </section>
  );
}

/** The two settings of the pattern test; applying keeps the choices above. */
function PatternSettings({ settings, onChange }: { settings: RunSettings; onChange: (settings: RunSettings) => void }) {
  const [threshold, setThreshold] = useState(settings.patternThresholdPercent);
  const [keepSpecial, setKeepSpecial] = useState(settings.keepSpecial);
  const changed = threshold !== settings.patternThresholdPercent || keepSpecial !== settings.keepSpecial;
  return (
    <div className="dq-advanced">
      <label><span className="dq-label">Rare-pattern threshold (% of group)</span><input type="number" min={0} max={50} step={0.5} value={threshold} onChange={(e) => setThreshold(Math.min(50, Math.max(0, Number(e.target.value) || 0)))} /></label>
      <label className="dq-check"><input type="checkbox" checked={keepSpecial} onChange={(e) => setKeepSpecial(e.target.checked)} /> Keep special characters as they are (otherwise “S”)</label>
      <button className="dq-btn" onClick={() => onChange({ ...settings, patternThresholdPercent: threshold, keepSpecial })} disabled={!changed}>Apply</button>
    </div>
  );
}
