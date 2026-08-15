import { useEffect, useMemo, useState } from "react";
import { planningApi } from "../api/planningApi";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { TextArea } from "../components/TextArea";
import { TextInput } from "../components/TextInput";
import type { PlanningAIReviewFinding, PlanningReadinessFinding, PlanningReadinessResponse, PlanningState, PlanningReadinessSeverity } from "../types";

function planningHasTests(planning: PlanningState): boolean {
  return planning.workstreams.some((workstream) =>
    workstream.objectives.some((objective) => objective.risks.some((risk) => risk.tests.length > 0))
  );
}

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

export function PlanningScreen({
  projectId,
  planning,
  onChange,
  onApprove,
  onReopen,
  agentExecutionEnabled = true,
  agentExecutionMessage = "AI agent execution is disabled."
}: {
  projectId: string;
  planning: PlanningState;
  onChange: (planning: PlanningState) => Promise<void>;
  onApprove: () => void | Promise<void>;
  onReopen: () => void | Promise<void>;
  agentExecutionEnabled?: boolean;
  agentExecutionMessage?: string;
}) {
  const [draft, setDraft] = useState(planning);
  const [expandedRisks, setExpandedRisks] = useState<Record<string, boolean>>({});
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>({});
  const [readiness, setReadiness] = useState<PlanningReadinessResponse | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessRunning, setReadinessRunning] = useState(false);
  const [readinessError, setReadinessError] = useState("");
  const hasTests = planningHasTests(draft);
  const aiFindings = useMemo(() => collectAiFindings(readiness), [readiness]);
  const deterministicFindings = readiness?.deterministic.findings || [];

  useEffect(() => {
    setDraft(planning);
  }, [planning]);

  useEffect(() => {
    let cancelled = false;
    setReadinessLoading(true);
    setReadinessError("");
    planningApi.readiness(projectId)
      .then((result) => {
        if (!cancelled) setReadiness(result);
      })
      .catch((err) => {
        if (!cancelled) setReadinessError(err instanceof Error ? err.message : "Unable to load planning readiness.");
      })
      .finally(() => {
        if (!cancelled) setReadinessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planning]);

  async function savePlanningEdits() {
    await onChange(draft);
    const next = await planningApi.readiness(projectId);
    setReadiness(next);
  }

  async function runReadinessReview() {
    setReadinessRunning(true);
    setReadinessError("");
    try {
      const next = await planningApi.runReadinessReview(projectId);
      setReadiness(next);
    } catch (err) {
      setReadinessError(err instanceof Error ? err.message : "Unable to run AI Planning Review.");
    } finally {
      setReadinessRunning(false);
    }
  }

  function updateObjective(workstreamIndex: number, objectiveIndex: number, field: "title" | "description", value: string) {
    const next = structuredClone(draft);
    next.workstreams[workstreamIndex].objectives[objectiveIndex][field] = value;
    next.workstreams[workstreamIndex].objectives[objectiveIndex].status = "Edited";
    setDraft(next);
  }

  function toggleRisk(riskId: string) {
    setExpandedRisks((current) => ({ ...current, [riskId]: !current[riskId] }));
  }

  function toggleTest(testId: string) {
    setExpandedTests((current) => ({ ...current, [testId]: !current[testId] }));
  }

  function updateRisk(
    workstreamIndex: number,
    objectiveIndex: number,
    riskIndex: number,
    field: "title" | "description" | "why_it_matters" | "potential_impact" | "severity",
    value: string
  ) {
    const next = structuredClone(draft);
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex][field] = value;
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex].status = "Edited";
    setDraft(next);
  }

  function updateTest(
    workstreamIndex: number,
    objectiveIndex: number,
    riskIndex: number,
    testIndex: number,
    field: "title" | "test_type" | "test_objective" | "description" | "expected_evidence" | "sample_considerations",
    value: string
  ) {
    const next = structuredClone(draft);
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex].tests[testIndex][field] = value;
    next.workstreams[workstreamIndex].objectives[objectiveIndex].risks[riskIndex].tests[testIndex].status = "Edited";
    setDraft(next);
  }

  return (
    <section className="screen-panel">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Planning</p>
          <h2>Audit Plan</h2>
        </div>
        <div className="button-row">
          <Button onClick={savePlanningEdits}>Save Planning Edits</Button>
          {draft.approved ? (
            <Button variant="secondary" onClick={onReopen}>Reopen Planning</Button>
          ) : (
            <Button variant="secondary" onClick={onApprove} disabled={!hasTests}>Complete Planning</Button>
          )}
        </div>
      </header>
      {draft.approved ? <p className="muted">Planning is complete. Reopen it if you need to make changes.</p> : null}
      {!hasTests ? <p className="muted">Generate tests before completing planning.</p> : null}
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
      <div className="planning-list">
        {draft.workstreams.map((workstream, workstreamIndex) => (
          <Card key={workstream.id}>
            <h3>{workstream.name}</h3>
            <p>{workstream.rationale}</p>
            {workstream.objectives.map((objective, objectiveIndex) => (
              <div className="editable-object" key={objective.id}>
                <TextInput
                  label="Objective title"
                  value={objective.title}
                  onChange={(event) => updateObjective(workstreamIndex, objectiveIndex, "title", event.target.value)}
                />
                <TextArea
                  label="Objective description"
                  value={objective.description}
                  onChange={(event) => updateObjective(workstreamIndex, objectiveIndex, "description", event.target.value)}
                  rows={3}
                />
                <div className="planning-subhead planning-section-header">
                  <strong>Risks</strong>
                  <span>{objective.risks.length} risk{objective.risks.length === 1 ? "" : "s"}</span>
                </div>
                <div className="mini-grid">
                  {objective.risks.map((risk, riskIndex) => (
                    <div className="mini-card planning-risk-card" key={risk.id}>
                      <button className="planning-expand-row" type="button" onClick={() => toggleRisk(risk.id)}>
                        <span>{expandedRisks[risk.id] ? "−" : "+"}</span>
                        <strong>{risk.title}</strong>
                        <em>{risk.severity || "No severity"}</em>
                      </button>
                      {expandedRisks[risk.id] ? (
                        <div className="planning-expanded-fields">
                          <TextInput
                            label="Risk title"
                            value={risk.title}
                            onChange={(event) => updateRisk(workstreamIndex, objectiveIndex, riskIndex, "title", event.target.value)}
                          />
                          <TextInput
                            label="Risk severity"
                            value={risk.severity}
                            onChange={(event) => updateRisk(workstreamIndex, objectiveIndex, riskIndex, "severity", event.target.value)}
                          />
                          <TextArea
                            label="Risk description"
                            value={risk.description}
                            onChange={(event) => updateRisk(workstreamIndex, objectiveIndex, riskIndex, "description", event.target.value)}
                            rows={3}
                          />
                        </div>
                      ) : null}
                      <div className="planning-tests">
                        <div className="planning-subhead">
                          <strong>Tests</strong>
                          <span>{risk.tests.length} test{risk.tests.length === 1 ? "" : "s"}</span>
                        </div>
                        {risk.tests.length ? (
                          risk.tests.map((test, testIndex) => (
                            <div className="planning-test-card" key={test.id}>
                              <button className="planning-expand-row test-row" type="button" onClick={() => toggleTest(test.id)}>
                                <span>{expandedTests[test.id] ? "−" : "+"}</span>
                                <strong>{test.title}</strong>
                                <em>{test.test_type || "No type"}</em>
                              </button>
                              {expandedTests[test.id] ? (
                                <div className="planning-expanded-fields">
                                  <TextInput
                                    label="Test title"
                                    value={test.title}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "title", event.target.value)}
                                  />
                                  <Select
                                    label="Test type"
                                    value={test.test_type}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "test_type", event.target.value)}
                                  >
                                    <option value="Test of Design">Test of Design</option>
                                    <option value="Test of Operating Effectiveness">Test of Operating Effectiveness</option>
                                    <option value="Detailed Test">Detailed Test</option>
                                    <option value="Analytical Review">Analytical Review</option>
                                  </Select>
                                  <TextArea
                                    label="Test objective"
                                    value={test.test_objective}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "test_objective", event.target.value)}
                                    rows={2}
                                  />
                                  <TextArea
                                    label="Description"
                                    value={test.description}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "description", event.target.value)}
                                    rows={3}
                                  />
                                  <TextArea
                                    label="Expected evidence"
                                    value={test.expected_evidence}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "expected_evidence", event.target.value)}
                                    rows={2}
                                  />
                                  <TextArea
                                    label="Sample considerations"
                                    value={test.sample_considerations}
                                    onChange={(event) => updateTest(workstreamIndex, objectiveIndex, riskIndex, testIndex, "sample_considerations", event.target.value)}
                                    rows={2}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="muted">No tests generated for this risk yet.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </section>
  );
}
