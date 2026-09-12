from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.time_utils import utc_now


PlanningReadinessSeverity = Literal["critical", "high", "medium", "low"]


class PlanningReadinessNavigation(BaseModel):
    node_id: str = ""
    node_type: str = ""
    phase: Literal["planning", "fieldwork", "reporting"] = "planning"


class PlanningReadinessFinding(BaseModel):
    id: str
    check_name: str
    category: str
    severity: PlanningReadinessSeverity
    explanation: str
    affected_artifact_ids: list[str] = Field(default_factory=list)
    affected_artifact_names: list[str] = Field(default_factory=list)
    branch: str = ""
    recommended_action: str = ""
    navigation: PlanningReadinessNavigation | None = None


class PlanningReadinessComponent(BaseModel):
    score: float
    max_score: float = 100
    status: str = ""
    summary: str = ""
    findings: list[PlanningReadinessFinding] = Field(default_factory=list)
    category_counts: dict[str, int] = Field(default_factory=dict)
    severity_counts: dict[str, int] = Field(default_factory=dict)


class PlanningAIReviewDimensionScore(BaseModel):
    dimension: str
    score: float
    explanation: str = ""


class PlanningAIReviewFinding(BaseModel):
    id: str
    category: str
    priority: Literal["Critical", "Important", "Enhancement"] = "Important"
    severity: PlanningReadinessSeverity = "medium"
    confidence: float = 0.7
    explanation: str
    suggested_action: str = ""
    affected_workstreams: list[str] = Field(default_factory=list)
    affected_artifact_ids: list[str] = Field(default_factory=list)
    affected_artifact_names: list[str] = Field(default_factory=list)


class PlanningAIReviewResult(BaseModel):
    status: Literal["success"] = "success"
    score: float
    reviewed_at: str = Field(default_factory=utc_now)
    provider: str = ""
    model: str = ""
    plan_fingerprint: str = ""
    stale: bool = False
    executive_summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    critical_gaps: list[PlanningAIReviewFinding] = Field(default_factory=list)
    warnings: list[PlanningAIReviewFinding] = Field(default_factory=list)
    duplication_findings: list[PlanningAIReviewFinding] = Field(default_factory=list)
    contradiction_findings: list[PlanningAIReviewFinding] = Field(default_factory=list)
    missing_coverage_findings: list[PlanningAIReviewFinding] = Field(default_factory=list)
    improvement_opportunities: list[PlanningAIReviewFinding] = Field(default_factory=list)
    prioritized_recommendations: list[PlanningAIReviewFinding] = Field(default_factory=list)
    dimension_scores: list[PlanningAIReviewDimensionScore] = Field(default_factory=list)


class PlanningAIReviewError(BaseModel):
    status: Literal["error"] = "error"
    reviewed_at: str = Field(default_factory=utc_now)
    error_message: str
    provider: str = ""
    model: str = ""


class PlanningReadinessWeights(BaseModel):
    deterministic: float = 0.65
    ai: float = 0.35


class PlanningReadinessState(BaseModel):
    latest_successful_ai_review: PlanningAIReviewResult | None = None
    latest_error: PlanningAIReviewError | None = None


class PlanningReadinessResponse(BaseModel):
    plan_fingerprint: str
    deterministic: PlanningReadinessComponent
    ai_review: PlanningAIReviewResult | None = None
    ai_error: PlanningAIReviewError | None = None
    weights: PlanningReadinessWeights = Field(default_factory=PlanningReadinessWeights)
    overall_score: float | None = None
    overall_status: Literal["awaiting_ai_review", "current", "stale_ai_review", "ai_review_failed"] = "awaiting_ai_review"
    overall_explanation: str = ""
