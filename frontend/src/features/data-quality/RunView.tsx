import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { dataQualityApi } from "./api";
import type { Dataset } from "./engine/csv";
import { cardInterpretations, reportWithInterpretation } from "./engine/interpretation";
import { formatRunDate } from "./engine/report";
import { VERDICT_LABEL } from "./engine/runner";
import { readSource, replayRun, type RunRecord } from "./engine/session";
import { gunzip } from "./engine/source";
import type { RuleParams, TemplateId, TestDefinition, TestNodeResult } from "./engine/types";
import { MapPanel } from "./map/MapPanel";
import { RunMap } from "./map/RunMap";
import type { RunCache } from "./NewRun";
import { ReportView } from "./ReportView";
import type { RunSection } from "./RunList";
import { SourceFileView } from "./SourceFileView";
import { TestResultScreen, type FullState } from "./TestResultScreen";
import { formatBytes, VERDICT_TONE, Working } from "./ui";

type Section = RunSection | { test: TemplateId };
type Full = { data: Dataset; bytes: ArrayBuffer; tests: TestNodeResult[] };

/**
 * A saved run. The map and summaries come from the saved record and show at once; the stored source
 * file is then loaded and the plan re-executed in the browser, which restores every exception record.
 */
export function RunView({ projectId, runId, initialSection, cache, canWrite, aiAvailable, onBack }: {
  projectId: string; runId: string; initialSection: RunSection; cache: RunCache | null; canWrite: boolean; aiAvailable: boolean; onBack: () => void;
}) {
  const [record, setRecord] = useState<RunRecord | null>(cache?.record ?? null);
  const [full, setFull] = useState<Full | null>(cache ? { data: cache.data, bytes: cache.bytes, tests: cache.results.tests } : null);
  const [fullState, setFullState] = useState<FullState>(cache ? "ready" : "loading");
  const [section, setSection] = useState<Section>(initialSection);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [savedRuleIds, setSavedRuleIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!canWrite) return;
    dataQualityApi.listRules(projectId).then((rules) => setSavedRuleIds(new Set(rules.map((r) => r.id)))).catch(() => undefined);
  }, [projectId, canWrite]);

  async function saveRule(testId: string) {
    const rule = record?.plan.find((t) => t.id === testId && t.template === "rule");
    if (!rule) return;
    try {
      const current = await dataQualityApi.listRules(projectId);
      const saved = await dataQualityApi.saveRules(projectId, [...current.filter((r) => r.id !== rule.id), { ...(rule as TestDefinition<RuleParams>), enabled: true, savedAt: undefined }]);
      setSavedRuleIds(new Set(saved.map((r) => r.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the rule.");
    }
  }

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await dataQualityApi.getRun(projectId, runId);
        if (cancelled) return;
        setRecord(loaded);
        if (!loaded.source.stored) { setFullState("unavailable"); return; }
        const bytes = await gunzip(await dataQualityApi.downloadFile(projectId, loaded.source.content_hash));
        const { data } = readSource(bytes, loaded.source.name);
        const replayed = await replayRun(loaded, data);
        if (cancelled) return;
        if (replayed.results.totals.exceptions !== loaded.totals.exceptions || replayed.results.totals.tests !== loaded.totals.tests) {
          setWarning("Re-running the stored file gave different totals than when the run was saved. The saved results are shown in the summaries.");
        }
        setFull({ data, bytes, tests: replayed.results.tests });
        setFullState("ready");
      } catch (err) {
        if (cancelled) return;
        setError((current) => current || (err instanceof Error ? err.message : "Unable to load the run."));
        setFullState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, runId, cache]);

  async function interpret() {
    if (!record) return;
    setInterpreting(true);
    setError("");
    try {
      const updated = await dataQualityApi.interpret(projectId, record.id);
      setRecord(updated);
      setSelected("interpretation");
      setSection("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI interpretation could not be completed.");
    } finally {
      setInterpreting(false);
    }
  }

  async function deleteRun() {
    if (!record || !window.confirm(`Delete this run on ${record.source.name}?\n\nIts results and stored source file are removed. This cannot be undone.`)) return;
    try { await dataQualityApi.deleteRun(projectId, record.id); onBack(); } catch (err) { setError(err instanceof Error ? err.message : "Unable to delete the run."); }
  }

  async function deleteFile() {
    if (!record || !window.confirm(`Delete the stored copy of ${record.source.name}?\n\nThe results stay, but the file and the full exception lists can no longer be shown. This cannot be undone.`)) return;
    try {
      await dataQualityApi.deleteFile(projectId, record.source.content_hash);
      setRecord({ ...record, source: { ...record.source, stored: false } });
      setFull(null);
      setFullState("unavailable");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to delete the source file."); }
  }

  if (!record) return error ? <div className="error-banner">{error}</div> : <p className="muted">Loading run…</p>;

  const tests = record.results;
  const tab = typeof section === "string" ? section : "map";
  return (
    <div className="dq-run-view">
      <div className="dq-section-head">
        <div>
          <button className="dq-link" onClick={onBack}>← All runs</button>
          <h3 className="dq-run-title">{record.source.name} <Badge tone={VERDICT_TONE[record.verdict]}>{VERDICT_LABEL[record.verdict]}</Badge></h3>
          <p className="muted dq-hint">{formatRunDate(record.created_at)} · {record.source.rows.toLocaleString()} rows · {record.source.columns} columns · {formatBytes(record.source.size)}{record.source.stored ? "" : " · source file deleted"}</p>
        </div>
        <div className="dq-file-bar">
          {canWrite && record.source.stored ? <button className="dq-btn" onClick={() => void deleteFile()}>Delete source file</button> : null}
          {canWrite && aiAvailable ? (
            <button className="dq-btn" onClick={() => void interpret()} disabled={interpreting} title="Ask the AI what the results mean and what to do next">
              {record.ai_interpretation ? "Interpret again with AI" : "Interpret results with AI"}
            </button>
          ) : null}
          {canWrite ? <button className="dq-btn dq-btn-danger" onClick={() => void deleteRun()}>Delete run</button> : null}
        </div>
      </div>
      <div className="dq-tabs" role="tablist">
        {(["map", "file", "report"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setSection(t)}>
            {t === "map" ? "Run map" : t === "file" ? "Source file" : "Report"}
          </button>
        ))}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {warning ? <div className="dq-banner">{warning}</div> : null}
      {interpreting ? <Working>The AI is reading the results and writing its interpretation. This usually takes 10–60 seconds.</Working> : null}
      {fullState === "loading" && typeof section === "string" && section !== "report" ? <Working>Loading the stored source file and rebuilding the full exception lists… the summaries below are already complete.</Working> : null}

      {section === "map" ? (
        <div className={`dq-map-layout${selected ? " with-panel" : ""}`}>
          <RunMap
            input={{ fileName: record.source.name, rows: record.source.rows, columns: record.profile.columns, relationships: record.profile.relationships, ai: record.ai_plan, interpretation: record.ai_interpretation, plan: record.plan, tests, totals: record.totals, verdict: record.verdict }}
            selected={selected}
            onSelect={setSelected}
          />
          {selected ? (
            <MapPanel nodeId={selected} record={record} tests={tests} onClose={() => setSelected(null)}
              onViewTest={(template) => setSection({ test: template })} onViewFile={() => setSection("file")} onViewReport={() => setSection("report")} />
          ) : <p className="muted dq-hint">Click a step on the map to see what happened in it.</p>}
        </div>
      ) : null}
      {typeof section === "object" ? (() => {
        const stored = tests.find((t) => t.template === section.test);
        if (!stored) return null;
        return <TestResultScreen key={section.test} stored={stored} full={full?.tests.find((t) => t.template === section.test) ?? null} fullState={fullState} onBack={() => setSection("map")}
          interpretations={cardInterpretations(record.ai_interpretation)}
          ruleSaving={canWrite ? { savedIds: savedRuleIds, onSave: (id) => void saveRule(id) } : undefined} />;
      })() : null}
      {section === "file" ? <SourceFileView fileName={record.source.name} data={full?.data ?? null} bytes={full?.bytes ?? null} state={fullState} stored={record.source.stored} /> : null}
      {section === "report" ? <ReportView markdown={reportWithInterpretation(record.report_markdown, record.ai_interpretation, record.results)} fileName={record.source.name} interpreted={Boolean(record.ai_interpretation)} /> : null}
    </div>
  );
}
