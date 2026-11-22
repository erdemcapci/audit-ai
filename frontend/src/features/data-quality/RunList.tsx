import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { dataQualityApi } from "./api";
import { AI_VERDICT_LABEL, type AiVerdict } from "./engine/interpretation";
import { formatRunDate } from "./engine/report";
import { VERDICT_LABEL } from "./engine/runner";
import type { RunSummary } from "./engine/session";
import { formatBytes, VERDICT_TONE } from "./ui";

export type RunSection = "map" | "file" | "report";

const n = (value: number) => value.toLocaleString("en-US");

/** Completed runs of this audit, newest first. Each card stays until the auditor deletes it. */
export function RunList({ projectId, canWrite, onNew, onOpen }: { projectId: string; canWrite: boolean; onNew: () => void; onOpen: (runId: string, section: RunSection) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = () => dataQualityApi.listRuns(projectId).then(setRuns).catch((err) => setError(err instanceof Error ? err.message : "Unable to load runs."));
  useEffect(() => { void load(); }, [projectId]);

  async function remove(run: RunSummary) {
    const shared = (runs ?? []).some((other) => other.id !== run.id && other.source.content_hash === run.source.content_hash);
    const removed = !run.source.stored ? "Its results are removed." : shared ?"Its results are removed. The stored source file is kept because another run uses it." : "Its results and stored source file are removed.";
    if (!window.confirm(`Delete the run on ${run.source.name} from ${formatRunDate(run.created_at)}?\n\n${removed} This cannot be undone.`)) return;
    try {
      await dataQualityApi.deleteRun(projectId, run.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete the run.");
    }
  }

  return (
    <div className="dq-runs">
      <div className="dq-section-head">
        <div>
          <h3>Runs</h3>
          <p className="muted dq-hint">Each run tests one file with a set of data quality tests. Results stay here until you delete them.</p>
        </div>
        {canWrite ? <button className="dq-btn dq-btn-primary" onClick={onNew}>New run</button> : null}
      </div>
      {!canWrite ? <div className="dq-banner">This hosted showcase is read-only. You can open the runs below, but not create or delete runs.</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {runs === null && !error ? <p className="muted">Loading runs…</p> : null}
      {runs && !runs.length ? (
        <div className="dq-empty">
          <strong>No runs yet</strong>
          <span>{canWrite ? "Start a new run with your own CSV file or a sample file." : "No runs have been published for this audit."}</span>
          {canWrite ? <div><button className="dq-btn dq-btn-primary" onClick={onNew}>New run</button></div> : null}
        </div>
      ) : null}
      <div className="dq-run-cards">
        {runs?.map((run) => (
          <article key={run.id} className="dq-run-card">
            <div className="dq-finding-head">
              <strong className="dq-run-file" title={run.source.name}>{run.source.name}</strong>
              <span className="dq-badges">
                <Badge tone={VERDICT_TONE[run.verdict as keyof typeof VERDICT_TONE] ?? "neutral"}>{VERDICT_LABEL[run.verdict as keyof typeof VERDICT_LABEL] ?? run.verdict}</Badge>
                {run.ai_verdict ? <Badge tone="purple">{`AI: ${AI_VERDICT_LABEL[run.ai_verdict as AiVerdict] ?? run.ai_verdict}`}</Badge> : null}
              </span>
            </div>
            <p className="muted dq-hint">{formatRunDate(run.created_at)} · {n(run.source.rows)} rows · {n(run.source.columns)} columns · {formatBytes(run.source.size)}</p>
            <p className="dq-run-totals">
              {n(run.totals.tests)} tests · {n(run.totals.findings)} finding{run.totals.findings === 1 ? "" : "s"}
              {run.totals.findings ? ` (${n(run.totals.high)} high, ${n(run.totals.medium)} medium, ${n(run.totals.low)} low)` : ""}
              {" · "}{run.ai_used ? "AI used" : "No AI"}
            </p>
            <div className="dq-run-actions">
              <button className="dq-btn dq-btn-primary" onClick={() => onOpen(run.id, "map")}>Open</button>
              <button className="dq-btn" onClick={() => onOpen(run.id, "file")} disabled={!run.source.stored} title={run.source.stored ? "Show the source file" : "The source file was deleted"}>View file</button>
              <button className="dq-btn" onClick={() => onOpen(run.id, "report")}>View report</button>
              {canWrite ? <button className="dq-btn dq-btn-danger" onClick={() => void remove(run)}>Delete run</button> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
