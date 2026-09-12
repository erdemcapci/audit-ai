import { useMemo } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import type { PlanningAIReviewFinding, PlanningReadinessFinding, PlanningReadinessResponse, PlanningReadinessSeverity } from "./types";

type AiFindingWithSource = PlanningAIReviewFinding & { source: string };

function scoreText(score: number) {
  return `${Math.round(score)}%`;
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString();
}

function statusTone(status: string): "neutral" | "blue" | "amber" | "green" | "red" | "purple" {
  if (status === "strong" || status === "current") return "green";
  if (status === "mostly_ready") return "blue";
  if (status === "needs_attention" || status === "stale_ai_review") return "amber";
  if (status === "not_ready" || status === "ai_review_failed") return "red";
  return "neutral";
}

function overallTone(status: string): "neutral" | "blue" | "amber" | "green" | "red" | "purple" {
  if (status === "current") return "green";
  if (status === "stale_ai_review") return "amber";
  if (status === "ai_review_failed") return "red";
  return "neutral";
}

function severityTone(severity: PlanningReadinessSeverity): "neutral" | "blue" | "amber" | "green" | "red" | "purple" {
  if (severity === "critical" || severity === "high") return "red";
  if (severity === "medium") return "amber";
  return "blue";
}

function collectAiFindings(readiness: PlanningReadinessResponse | null): AiFindingWithSource[] {
  if (!readiness?.ai_review) return [];
  return [
    ...readiness.ai_review.critical_gaps.map((finding) => ({ ...finding, source: "Critical Gap" })),
    ...readiness.ai_review.warnings.map((finding) => ({ ...finding, source: "Warning" })),
    ...readiness.ai_review.duplication_findings.map((finding) => ({ ...finding, source: "Duplication" })),
    ...readiness.ai_review.contradiction_findings.map((finding) => ({ ...finding, source: "Contradiction" })),
    ...readiness.ai_review.missing_coverage_findings.map((finding) => ({ ...finding, source: "Missing Coverage" })),
    ...readiness.ai_review.improvement_opportunities.map((finding) => ({ ...finding, source: "Improvement" })),
    ...readiness.ai_review.prioritized_recommendations.map((finding) => ({ ...finding, source: "Recommendation" }))
  ];
}

function DeterministicFinding({ finding }: { finding: PlanningReadinessFinding }) {
  return (
    <article className="readiness-finding">
      <div className="readiness-finding-topline">
        <Badge tone={severityTone(finding.severity)}>{formatStatus(finding.severity)}</Badge>
        <span>{finding.category}</span>
      </div>
      <strong>{finding.check_name}</strong>
      <p>{finding.explanation}</p>
      {finding.affected_artifact_names.length ? <small>{finding.affected_artifact_names.join(", ")}</small> : null}
      {finding.recommended_action ? <em>{finding.recommended_action}</em> : null}
    </article>
  );
}

function AiFinding({ finding }: { finding: AiFindingWithSource }) {
  return (
    <article className="readiness-finding">
      <div className="readiness-finding-topline">
        <Badge tone={severityTone(finding.severity)}>{finding.priority}</Badge>
        <span>{finding.source}</span>
      </div>
      <strong>{finding.category}</strong>
      <p>{finding.explanation}</p>
      {finding.affected_artifact_names.length ? <small>{finding.affected_artifact_names.join(", ")}</small> : null}
      {finding.suggested_action ? <em>{finding.suggested_action}</em> : null}
    </article>
  );
}

export function PlanningReadinessPanel({
  readiness, readinessLoading, readinessRunning, readinessError,
  runReadinessReview, agentExecutionEnabled, agentExecutionMessage
}: {
  readiness: PlanningReadinessResponse | null;
  readinessLoading: boolean;
  readinessRunning: boolean;
  readinessError: string;
  runReadinessReview: () => Promise<void>;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
}) {
  const aiFindings = useMemo(() => collectAiFindings(readiness), [readiness]);
  const deterministicFindings = readiness?.deterministic.findings || [];
  return (
      <section className="planning-readiness">
        <div className="planning-readiness-header">
          <div>
            <p className="eyebrow">Planning Readiness</p>
            <h3>Readiness and AI Quality Review</h3>
          </div>
          <div className="button-row">
            <Button
              variant="secondary"
              onClick={runReadinessReview}
              disabled={readinessRunning || !agentExecutionEnabled}
              title={!agentExecutionEnabled ? agentExecutionMessage : undefined}
            >
              {readinessRunning ? "Reviewing..." : "Run AI Planning Review"}
            </Button>
          </div>
        </div>
        {readinessError ? <p className="error-message">{readinessError}</p> : null}
        {readinessLoading && !readiness ? <p className="muted">Loading readiness...</p> : null}
        {readiness ? (
          <>
            <div className="planning-readiness-grid">
              <div className="readiness-score-card">
                <span>Deterministic</span>
                <strong>{scoreText(readiness.deterministic.score)}</strong>
                <Badge tone={statusTone(readiness.deterministic.status)}>{formatStatus(readiness.deterministic.status)}</Badge>
                <p>{readiness.deterministic.summary}</p>
              </div>
              <div className="readiness-score-card">
                <span>AI Quality Review</span>
                <strong>{readiness.ai_review ? scoreText(readiness.ai_review.score) : "Pending"}</strong>
                <Badge tone={readiness.ai_review?.stale ? "amber" : readiness.ai_review ? "green" : readiness.ai_error ? "red" : "neutral"}>
                  {readiness.ai_review?.stale ? "Stale" : readiness.ai_review ? "Current" : readiness.ai_error ? "Failed" : "Not Run"}
                </Badge>
                <p>
                  {readiness.ai_review
                    ? `${readiness.ai_review.provider || "AI"} ${readiness.ai_review.model || ""} reviewed ${formatDate(readiness.ai_review.reviewed_at)}.`
                    : "Run the review for a qualitative planning assessment."}
                </p>
              </div>
              <div className="readiness-score-card">
                <span>Overall</span>
                <strong>{readiness.overall_score === null ? "Pending" : scoreText(readiness.overall_score)}</strong>
                <Badge tone={overallTone(readiness.overall_status)}>{formatStatus(readiness.overall_status)}</Badge>
                <p>{readiness.overall_explanation}</p>
              </div>
            </div>
            {readiness.ai_error ? <p className="muted">Latest review error: {readiness.ai_error.error_message}</p> : null}
            {readiness.ai_review?.executive_summary ? <p className="readiness-summary">{readiness.ai_review.executive_summary}</p> : null}
            {readiness.ai_review?.dimension_scores.length ? (
              <div className="readiness-dimensions">
                {readiness.ai_review.dimension_scores.map((dimension) => (
                  <div key={dimension.dimension}>
                    <strong>{dimension.dimension}</strong>
                    <span>{scoreText(dimension.score)}</span>
                    <p>{dimension.explanation}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="readiness-findings-grid">
              <div>
                <div className="planning-subhead">
                  <strong>Deterministic Findings</strong>
                  <span>{deterministicFindings.length}</span>
                </div>
                <div className="readiness-finding-list">
                  {deterministicFindings.length ? (
                    deterministicFindings.map((finding) => <DeterministicFinding key={finding.id} finding={finding} />)
                  ) : (
                    <p className="muted">No deterministic findings.</p>
                  )}
                </div>
              </div>
              <div>
                <div className="planning-subhead">
                  <strong>AI Review Findings</strong>
                  <span>{aiFindings.length}</span>
                </div>
                <div className="readiness-finding-list">
                  {aiFindings.length ? (
                    aiFindings.map((finding) => <AiFinding key={finding.id} finding={finding} />)
                  ) : (
                    <p className="muted">No AI review findings.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </section>
  );
}
