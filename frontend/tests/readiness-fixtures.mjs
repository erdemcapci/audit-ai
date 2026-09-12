export const pending = {
  plan_fingerprint: "plan-1",
  deterministic: {
    score: 75, max_score: 100, status: "mostly_ready", summary: "One issue found.",
    category_counts: { Structure: 1 }, severity_counts: { high: 1 },
    findings: [{ id: "det-1", check_name: "Risk without tests", category: "Structure", severity: "high", explanation: "A risk has no tests.", affected_artifact_ids: ["risk-1"], affected_artifact_names: ["Approval risk"], recommended_action: "Add a test.", branch: "Approvals" }]
  },
  ai_review: null, ai_error: null, weights: { deterministic: 0.65, ai: 0.35 },
  overall_score: null, overall_status: "awaiting_ai_review", overall_explanation: "Awaiting review."
};
const finding = { id: "ai-1", category: "Coverage", priority: "Important", severity: "medium", confidence: 0.8, explanation: "Evidence coverage is incomplete.", suggested_action: "Review source evidence.", affected_artifact_names: ["Approval risk"] };
export const current = {
  ...pending,
  ai_review: {
    score: 80, provider: "demo", model: "deterministic-demo", reviewed_at: "invalid-date", stale: false,
    executive_summary: "Plan review complete.", dimension_scores: [{ dimension: "Coverage", score: 80, explanation: "Some gaps." }],
    critical_gaps: [], warnings: [finding], duplication_findings: [], contradiction_findings: [], missing_coverage_findings: [], improvement_opportunities: [], prioritized_recommendations: []
  },
  overall_score: 76.75, overall_status: "current", overall_explanation: "Combined score."
};
const defaults = { readiness: null, readinessLoading: false, readinessRunning: false, readinessError: "", runReadinessReview: async () => {}, agentExecutionEnabled: true, agentExecutionMessage: "AI execution disabled." };
export const scenarios = {
  loading: { ...defaults, readinessLoading: true },
  pending: { ...defaults, readiness: pending },
  current: { ...defaults, readiness: current },
  stale: { ...defaults, readiness: { ...current, ai_review: { ...current.ai_review, stale: true }, overall_score: null, overall_status: "stale_ai_review" } },
  failed: { ...defaults, readiness: { ...pending, ai_error: { error_message: "Provider failed." }, overall_status: "ai_review_failed" }, readinessError: "Unable to run AI Planning Review." },
  running: { ...defaults, readiness: current, readinessRunning: true },
  disabled: { ...defaults, readiness: pending, agentExecutionEnabled: false }
};
