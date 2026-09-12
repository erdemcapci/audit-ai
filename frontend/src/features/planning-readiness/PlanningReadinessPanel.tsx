import { useMemo } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { summarizeReadiness, type ReadinessIssue } from "./summary";
import type { PlanningReadinessResponse } from "./types";

function scoreText(score: number) {
  return score.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}

function IssueCard({ issue, artifactLabels, onOpenArtifact }: {
  issue: ReadinessIssue;
  artifactLabels: Record<string, string>;
  onOpenArtifact?: (nodeId: string) => void;
}) {
  return <article className="readiness-finding">
    <div className="readiness-finding-topline">
      <Badge tone={issue.severity === "critical" || issue.severity === "high" ? "red" : issue.severity === "medium" ? "amber" : "blue"}>
        {issue.severity === "critical" ? "Critical" : issue.severity === "high" ? "High priority" : "Improvement"}
      </Badge>
      <span>{issue.sources.join(" + ")}</span>
    </div>
    <h4>{issue.title}</h4>
    <p>{issue.explanation}</p>
    {issue.branch ? <small>{issue.branch}</small> : null}
    <div className="readiness-action"><strong>Recommended improvement</strong><p>{issue.action || "Review the affected area and agree the next action with the audit team."}</p></div>
    <div className="readiness-artifacts">
      {issue.artifactIds.length ? [...new Set(issue.artifactIds)].map((id, index) => {
        const available = Object.prototype.hasOwnProperty.call(artifactLabels, id);
        const label = artifactLabels[id] || issue.artifactNames[index] || id;
        return onOpenArtifact ? <Button key={id} variant="ghost" disabled={!available}
          title={available ? "Open and focus this audit-plan card" : "This card is not in the current audit plan"}
          onClick={() => onOpenArtifact(id)}>View {label}</Button> : <span key={id}>{label}</span>;
      }) : <small>{issue.artifactNames.join(", ") || "Whole plan — no specific card linked."}</small>}
    </div>
  </article>;
}

export function PlanningReadinessPanel({
  readiness, readinessLoading, readinessRunning, readinessError,
  runReadinessReview, agentExecutionEnabled, agentExecutionMessage,
  artifactLabels = {}, onOpenArtifact
}: {
  readiness: PlanningReadinessResponse | null;
  readinessLoading: boolean;
  readinessRunning: boolean;
  readinessError: string;
  runReadinessReview: () => Promise<void>;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
  artifactLabels?: Record<string, string>;
  onOpenArtifact?: (nodeId: string) => void;
}) {
  const result = useMemo(() => readiness ? summarizeReadiness(readiness) : null, [readiness]);
  const review = readiness?.ai_review;
  const tone = result?.status === "Ready" ? "green" : result?.status === "Ready with improvements" ? "blue" : result?.status === "Needs attention" ? "amber" : "red";
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
        <div className="readiness-management-score">
          <span>{result.preliminary ? "Plan checks · overall pending" : "Overall readiness"}</span>
          <strong>{scoreText(result.score)} <small>/ 100</small></strong>
          <Badge tone={tone}>{result.preliminary ? `Preliminary: ${result.status}` : result.status}</Badge>
        </div>
        <div className="readiness-management-message">
          <p className="readiness-decision">{result.summary}</p>
          <p><strong>{result.important}</strong> important {result.important === 1 ? "issue" : "issues"} <span className="muted">· {result.findings.length} distinct findings</span></p>
          {result.biggestConcern ? <><strong>Biggest concern</strong><p>{result.biggestConcern.explanation}</p>
            <a href="#readiness-priorities">Review priorities and affected cards ↓</a></> : null}
        </div>
      </div>
      {result.preliminary ? <p className="readiness-review-notice" role="status">
        {review?.stale ? "The plan has changed since the saved AI review. Its findings are excluded from the current summary. Run a new review to confirm overall readiness."
          : "Overall readiness is pending a successful AI review. The preliminary score and findings above use current plan checks only."}
      </p> : <p className="muted">Overall readiness combines {Math.round(readiness.weights.deterministic * 100)}% plan checks and {Math.round(readiness.weights.ai * 100)}% AI review. Readiness supports the audit manager’s judgment; it does not approve the plan.</p>}
      {readiness.ai_error ? <p className="error-message">Latest AI review failed: {readiness.ai_error.error_message}{!result.preliminary ? " The last successful review still matches this plan." : ""}</p> : null}
      <section id="readiness-priorities" className="readiness-priorities">
        <h3>What to improve next</h3>
        <p className="muted">Critical and high-priority findings first. Repeated findings for the same affected cards are shown once.</p>
        {result.findings.length ? <div className="readiness-finding-list">{result.findings.map((issue, index) => <IssueCard key={`${issue.id}-${index}`} issue={issue} artifactLabels={artifactLabels} onOpenArtifact={onOpenArtifact} />)}</div>
          : <p>No findings in the current assessment.</p>}
      </section>
      {review && !result.preliminary && review.dimension_scores.length > 0 ? <section>
        <h3>Readiness dimensions</h3><div className="readiness-dimensions">{review.dimension_scores.map((dimension, index) => <div key={`${dimension.dimension}-${index}`}>
          <strong>{dimension.dimension}</strong><span>{scoreText(dimension.score)} / 100</span><p>{dimension.explanation}</p>
        </div>)}</div>
      </section> : null}
      <details className="readiness-review-details">
        <summary>{review?.stale ? "Previous AI review — outdated" : "Review details and scoring"}</summary>
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
        <p>Decision rules: a score below 55 or a critical finding means Not ready; a score below 75 or a high-priority finding means Needs attention; a score below 90 or remaining improvements means Ready with improvements. Ready requires at least 90 and no findings.</p>
      </details>
    </> : !readinessLoading && !readinessError ? <p>Run a review to assess your audit plan.</p> : null}
  </section>;
}
