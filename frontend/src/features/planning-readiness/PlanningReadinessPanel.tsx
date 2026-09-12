import { useMemo } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { summarizeReadiness, type ReadinessIssue } from "./summary";
import { artifactGroup, conciseText, displayLabel, findingArtifacts, type ArtifactPresentations } from "./presentation";
import type { PlanningReadinessResponse } from "./types";

function scoreText(score: number) {
  return score.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}

function IssueCard({ issue, artifacts, onOpenArtifact, onOpenArtifacts }: {
  issue: ReadinessIssue;
  artifacts: ArtifactPresentations;
  onOpenArtifact?: (nodeId: string) => void;
  onOpenArtifacts?: (nodeIds: string[]) => void;
}) {
  const { ids, items, areas } = findingArtifacts(issue, artifacts);
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const group = artifactGroup(item.type);
    groups.set(group, [...(groups.get(group) || []), item]);
  }
  const problem = issue.title !== issue.category ? conciseText(issue.title) : conciseText(issue.explanation);
  return <article className="readiness-finding">
    <div className="readiness-finding-topline">
      <strong>{issue.category}</strong>
      <Badge tone={issue.severity === "critical" || issue.severity === "high" ? "red" : issue.severity === "medium" ? "amber" : "blue"}>
        {issue.severity === "critical" ? "Critical" : issue.severity === "high" ? "High priority" : issue.severity === "medium" ? "Medium" : "Low"}
      </Badge>
    </div>
    <h4>{problem}</h4>
    {areas.length ? <div className="readiness-areas"><strong>Affected areas</strong>
      <p>{areas.slice(0, 3).join(" · ")}{areas.length > 3 ? ` · +${areas.length - 3} more areas` : ""}</p>
    </div> : null}
    <div className="readiness-action"><strong>Recommended improvement</strong><p>{conciseText(issue.action) || "Review the affected area and agree the next action with the audit team."}</p></div>
    {ids.length === 1 && onOpenArtifact ? <Button className="readiness-map-action" variant="secondary" onClick={() => onOpenArtifact(ids[0])}>Show on audit map</Button>
      : ids.length > 1 && onOpenArtifacts ? <Button className="readiness-map-action" variant="secondary" onClick={() => onOpenArtifacts(ids)}>Show {ids.length} affected items on map</Button> : null}
    {items.length ? <details className="readiness-related"><summary>{items.length} related plan {items.length === 1 ? "item" : "items"}</summary>
      <div className="readiness-related-list">{[...groups].map(([group, members]) => <section key={group}>
        <h5>{group} ({members.length})</h5><ul>{members.map((item) => <li key={item.id}>
          {onOpenArtifact ? <button type="button" className="readiness-item-link" onClick={() => onOpenArtifact(item.id)}>{item.label} <span aria-hidden="true">↗</span></button> : item.label}
        </li>)}</ul>
      </section>)}</div>
    </details> : null}
    <details className="readiness-finding-details"><summary>Details</summary>
      <p>{issue.explanation}</p>
      <strong>Full recommendation</strong><p>{issue.action || "Review the affected area and agree the next action with the audit team."}</p>
      {areas.length ? <><strong>Affected areas</strong><p>{areas.join(" · ")}</p></> : null}
      <small>{issue.sources.join(" + ")}</small>
    </details>
  </article>;
}

export function PlanningReadinessPanel({
  readiness, readinessLoading, readinessRunning, readinessError,
  runReadinessReview, agentExecutionEnabled, agentExecutionMessage,
  artifactLabels = {}, artifacts, onOpenArtifact, onOpenArtifacts
}: {
  readiness: PlanningReadinessResponse | null;
  readinessLoading: boolean;
  readinessRunning: boolean;
  readinessError: string;
  runReadinessReview: () => Promise<void>;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
  artifactLabels?: Record<string, string>;
  artifacts?: ArtifactPresentations;
  onOpenArtifacts?: (nodeIds: string[]) => void;
  onOpenArtifact?: (nodeId: string) => void;
}) {
  const currentArtifacts = artifacts || Object.fromEntries(Object.entries(artifactLabels).map(([id, label]) => [id, { label: displayLabel(label, id), type: "", area: "" }]));
  const result = useMemo(() => readiness ? summarizeReadiness(readiness) : null, [readiness]);
  const review = readiness?.ai_review;
  return <section className="planning-readiness" aria-label="Audit plan readiness">
    <div className="planning-readiness-header">
      <div><p className="eyebrow">Planning Readiness</p><h2>Audit Plan Readiness</h2></div>
      <Button variant="secondary" onClick={runReadinessReview} disabled={readinessRunning || readinessLoading || !agentExecutionEnabled}
        title={!agentExecutionEnabled ? agentExecutionMessage : undefined}>
        {readinessRunning ? "Reviewing..." : review ? "Run AI Review Again" : "Run AI Planning Review"}
      </Button>
    </div>
    {readinessError ? <p className="error-message" role="alert">{readinessError}</p> : null}
    {readinessLoading ? <p className="muted" role="status">{readiness ? "Updating readiness…" : "Loading readiness…"}</p> : null}
    {readiness && result ? <>
      <div className="readiness-management-summary">
        <div className="readiness-score-pair">
          <div className="readiness-management-score readiness-ai-score">
            <span>AI review{review?.provider === "demo" ? " (demo)" : ""}</span>
            <strong>{!result.preliminary && review ? <>{scoreText(review.score)} <small>/ 100</small></> : "—"}</strong>
            <small>{!result.preliminary ? "Plan quality" : review?.stale ? "Review outdated" : readiness.ai_error ? "Review unavailable" : "Not reviewed yet"}</small>
          </div>
          <div className="readiness-management-score readiness-checks-score">
            <span>Deterministic</span>
            <strong>{scoreText(readiness.deterministic.score)} <small>/ 100</small></strong>
            <small>Structure and completeness checks</small>
          </div>
        </div>
      </div>
      {result.preliminary ? <p className="readiness-review-notice" role="status">
        {review?.stale ? "The plan has changed since the saved AI review. Its findings are excluded from the current summary. Run a new review to confirm overall readiness."
          : "Overall readiness is pending a successful AI review. Current findings use plan checks only."}
      </p> : null}
      {readiness.ai_error ? <p className="error-message">Latest AI review failed: {readiness.ai_error.error_message}{!result.preliminary ? " The last successful review still matches this plan." : ""}</p> : null}
      <section id="readiness-priorities" className="readiness-priorities">
        <h3>What to improve next</h3>
        <p className="muted">Critical and high-priority findings first. Repeated findings for the same affected cards are shown once.</p>
        {result.findings.length ? <div className="readiness-finding-list">{result.findings.map((issue, index) => <IssueCard key={`${issue.id}-${index}`} issue={issue} artifacts={currentArtifacts} onOpenArtifact={onOpenArtifact} onOpenArtifacts={onOpenArtifacts} />)}</div>
          : <p>No findings in the current assessment.</p>}
      </section>
      {review && !result.preliminary && review.dimension_scores.length > 0 ? <section>
        <h3>Readiness dimensions</h3><div className="readiness-dimensions">{review.dimension_scores.map((dimension, index) => <div key={`${dimension.dimension}-${index}`}>
          <strong>{dimension.dimension}</strong><span>{scoreText(dimension.score)} / 100</span><p>{dimension.explanation}</p>
        </div>)}</div>
      </section> : null}
      <details className="readiness-review-details">
        <summary>{review?.stale ? "Previous AI review — outdated" : "Review details and scoring"}</summary>
        <p>{result.preliminary ? "Preliminary plan status" : "Overall plan status"}: {result.status}</p>
        {!result.preliminary ? <p>Combined readiness score: {scoreText(result.score)} / 100.</p> : null}
        <p>Plan checks: {scoreText(readiness.deterministic.score)} / 100. {readiness.deterministic.summary}</p>
        {review ? <>
          <p>AI review: {scoreText(review.score)} / 100 · {review.provider || "AI"} {review.model} · reviewed {formatDate(review.reviewed_at)}.</p>
          {review.executive_summary ? <p>{review.executive_summary}</p> : null}
          {review.strengths?.length ? <><h4>Strengths</h4><ul>{review.strengths.map((strength, index) => <li key={index}>{strength}</li>)}</ul></> : null}
          {review.stale ? <><p>These results refer to the previous plan and do not contribute to the current summary.</p>
            {review.dimension_scores.map((dimension, index) => <p key={index}>{dimension.dimension}: {scoreText(dimension.score)} / 100 — {dimension.explanation}</p>)}
            {[...review.critical_gaps, ...review.warnings, ...review.duplication_findings, ...review.contradiction_findings, ...review.missing_coverage_findings, ...review.improvement_opportunities, ...review.prioritized_recommendations].map((finding, index) => <p key={index}>{finding.explanation} {finding.suggested_action}</p>)}
          </> : null}
        </> : <p>An AI review has not completed successfully yet.</p>}
        <p>Decision rules use the combined score (or deterministic score while preliminary): a score below 55 or a critical finding means Not ready; a score below 75 or a high-priority finding means Needs attention; a score below 90 or remaining improvements means Ready with improvements. Ready requires at least 90 and no findings.</p>
      </details>
    </> : !readinessLoading && !readinessError ? <p>Run a review to assess your audit plan.</p> : null}
  </section>;
}
