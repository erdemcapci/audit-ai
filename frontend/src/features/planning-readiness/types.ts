export type PlanningReadinessSeverity = "critical" | "high" | "medium" | "low";

export type PlanningReadinessFinding = {
  id: string;
  check_name: string;
  category: string;
  severity: PlanningReadinessSeverity;
  explanation: string;
  affected_artifact_ids: string[];
  affected_artifact_names: string[];
  branch: string;
  recommended_action: string;
  navigation?: { node_id: string; node_type: string; phase: "planning" | "fieldwork" | "reporting" } | null;
};

export type PlanningReadinessComponent = {
  score: number;
  max_score: number;
  status: string;
  summary: string;
  findings: PlanningReadinessFinding[];
  category_counts: Record<string, number>;
  severity_counts: Record<string, number>;
};

export type PlanningAIReviewFinding = {
  id: string;
  category: string;
  priority: "Critical" | "Important" | "Enhancement";
  severity: PlanningReadinessSeverity;
  confidence: number;
  explanation: string;
  suggested_action: string;
  affected_workstreams: string[];
  affected_artifact_ids: string[];
  affected_artifact_names: string[];
};

export type PlanningAIReviewResult = {
  status: "success";
  score: number;
  reviewed_at: string;
  provider: string;
  model: string;
  plan_fingerprint: string;
  stale: boolean;
  executive_summary: string;
  strengths: string[];
  critical_gaps: PlanningAIReviewFinding[];
  warnings: PlanningAIReviewFinding[];
  duplication_findings: PlanningAIReviewFinding[];
  contradiction_findings: PlanningAIReviewFinding[];
  missing_coverage_findings: PlanningAIReviewFinding[];
  improvement_opportunities: PlanningAIReviewFinding[];
  prioritized_recommendations: PlanningAIReviewFinding[];
  dimension_scores: Array<{ dimension: string; score: number; explanation: string }>;
};

export type PlanningReadinessResponse = {
  plan_fingerprint: string;
  deterministic: PlanningReadinessComponent;
  ai_review: PlanningAIReviewResult | null;
  ai_error: { status: "error"; reviewed_at: string; error_message: string; provider: string; model: string } | null;
  weights: { deterministic: number; ai: number };
  overall_score: number | null;
  overall_status: "awaiting_ai_review" | "current" | "stale_ai_review" | "ai_review_failed";
  overall_explanation: string;
};
