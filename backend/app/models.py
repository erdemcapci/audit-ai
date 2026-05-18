from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


StatusBadge = Literal[
    "AI Generated",
    "Edited",
    "Confirmed",
    "Draft",
    "In Progress",
    "Issue Found",
    "Ready for Report",
]

AgentStatus = Literal["idle", "ready", "running", "completed", "error"]


class AuditCreate(BaseModel):
    title: str
    description: str
    process_area: str = ""
    initial_concern: str = ""
    extra_context: str = ""


class AuditProject(BaseModel):
    id: str = Field(default_factory=lambda: new_id("audit"))
    slug: str
    title: str
    description: str
    process_area: str = ""
    initial_concern: str = ""
    extra_context: str = ""
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)
    status: str = "planning"


class Risk(BaseModel):
    id: str = Field(default_factory=lambda: new_id("risk"))
    title: str
    description: str = ""
    why_it_matters: str = ""
    potential_impact: str = ""
    severity: str = "Medium"
    status: StatusBadge = "AI Generated"
    tests: list["Test"] = Field(default_factory=list)


class Objective(BaseModel):
    id: str = Field(default_factory=lambda: new_id("obj"))
    title: str
    description: str = ""
    scope_notes: str = ""
    rationale: str = ""
    status: StatusBadge = "AI Generated"
    risks: list[Risk] = Field(default_factory=list)


class Workstream(BaseModel):
    id: str = Field(default_factory=lambda: new_id("ws"))
    name: str
    description: str = ""
    rationale: str = ""
    status: StatusBadge = "AI Generated"
    objectives: list[Objective] = Field(default_factory=list)


class Test(BaseModel):
    id: str = Field(default_factory=lambda: new_id("test"))
    title: str
    test_type: str = "Detailed Test"
    test_objective: str = ""
    description: str = ""
    expected_evidence: str = ""
    sample_considerations: str = ""
    status: StatusBadge = "AI Generated"
    generated_by_agent_id: str | None = None


class PlanningState(BaseModel):
    version: int = 1
    stage: str = "empty"
    approved: bool = False
    workstreams: list[Workstream] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class InterviewQuestion(BaseModel):
    id: str = Field(default_factory=lambda: new_id("iq"))
    question_text: str
    mapped_objective_id: str | None = None
    mapped_risk_id: str | None = None
    mapped_test_id: str | None = None
    status: StatusBadge = "AI Generated"


class InterviewRole(BaseModel):
    id: str = Field(default_factory=lambda: new_id("role"))
    role_title: str
    rationale: str = ""
    expected_information: str = ""
    notes: str = ""
    questions: list[InterviewQuestion] = Field(default_factory=list)
    status: StatusBadge = "AI Generated"


class InterviewPlan(BaseModel):
    roles: list[InterviewRole] = Field(default_factory=list)


class FieldworkItem(BaseModel):
    id: str = Field(default_factory=lambda: new_id("fw"))
    test_id: str
    source_test_id: str | None = None
    title: str
    test_type: str = ""
    description: str = ""
    expected_evidence: str = ""
    status: str = "Not Started"
    notes: str = ""
    evidence_placeholder: str = ""
    finding_ids: list[str] = Field(default_factory=list)


class FieldworkState(BaseModel):
    items: list[FieldworkItem] = Field(default_factory=list)


class FieldworkCreateFromPlanningRequest(BaseModel):
    mode: Literal["keep", "missing", "replace"] = "missing"


class DocumentRequest(BaseModel):
    id: str = Field(default_factory=lambda: new_id("docreq"))
    title: str
    description: str = ""
    requested_from: str = ""
    expected_document: str = ""
    rationale: str = ""
    source_node_id: str | None = None
    status: StatusBadge = "AI Generated"


class DocumentRequestState(BaseModel):
    requests: list[DocumentRequest] = Field(default_factory=list)


class FindingDraftRequest(BaseModel):
    raw_description: str
    fieldwork_item_id: str | None = None


class Finding(BaseModel):
    id: str = Field(default_factory=lambda: new_id("finding"))
    title: str
    raw_description: str = ""
    issue: str = ""
    criteria: str = ""
    root_cause: str = ""
    impact: str = ""
    recommendation: str = ""
    management_action: str = ""
    severity: str = "Medium"
    evidence_needed: list[str] = Field(default_factory=list)
    validation_questions: list[str] = Field(default_factory=list)
    linked_fieldwork_item_id: str | None = None
    status: StatusBadge = "Draft"


class FindingsState(BaseModel):
    findings: list[Finding] = Field(default_factory=list)


class ReportState(BaseModel):
    executive_summary: str = ""
    audit_conclusion: str = ""
    key_themes: list[str] = Field(default_factory=list)
    issue_summary: str = ""
    management_attention_points: list[str] = Field(default_factory=list)
    draft_report_structure: list[dict[str, Any]] = Field(default_factory=list)
    ai_improved_version: str = ""
    draft_markdown: str = ""


class LLMSettings(BaseModel):
    provider: str
    model: str
    demo_mode: bool
    ollama_base_url: str
    openai_configured: bool
    anthropic_configured: bool


class LLMSettingsUpdate(BaseModel):
    provider: Literal["ollama", "openai", "claude"]
    model: str | None = None
    demo_mode: bool | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None


class FlowNode(BaseModel):
    id: str
    type: str
    position: dict[str, float]
    data: dict[str, Any]
    width: float | None = None
    height: float | None = None


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str = "smoothstep"
    animated: bool = False
    data: dict[str, Any] = Field(default_factory=dict)


class AuditMap(BaseModel):
    nodes: list[FlowNode]
    edges: list[FlowEdge]


class PhaseLayout(BaseModel):
    x: float
    y: float
    width: float
    height: float


def default_phase_layouts() -> dict[str, PhaseLayout]:
    return {
        "planning": PhaseLayout(x=0, y=0, width=2500, height=900),
        "fieldwork": PhaseLayout(x=2660, y=0, width=1100, height=1260),
        "reporting": PhaseLayout(x=3920, y=0, width=960, height=900),
    }


class AgentDefinition(BaseModel):
    type: str
    title: str
    description: str
    default_prompt: str
    default_config: dict[str, Any] = Field(default_factory=dict)
    allowed_input_node_types: list[str] = Field(default_factory=list)
    output_node_types: list[str] = Field(default_factory=list)


class AgentState(BaseModel):
    id: str = Field(default_factory=lambda: new_id("agent"))
    type: str
    title: str
    prompt: str
    config: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] = Field(default_factory=lambda: {"x": 360, "y": 240})
    status: AgentStatus = "idle"
    last_run_at: str | None = None
    last_error: str = ""
    last_output: dict[str, Any] = Field(default_factory=dict)


class MapState(BaseModel):
    phaseLayouts: dict[str, PhaseLayout] = Field(default_factory=default_phase_layouts)
    nodePositions: dict[str, dict[str, float]] = Field(default_factory=dict)
    nodeDimensions: dict[str, dict[str, float]] = Field(default_factory=dict)
    edges: list[FlowEdge] = Field(default_factory=list)
    agents: list[AgentState] = Field(default_factory=list)
    deletedAgentIds: list[str] = Field(default_factory=list)


class MapStateUpdate(BaseModel):
    phaseLayouts: dict[str, PhaseLayout] | None = None
    nodePositions: dict[str, dict[str, float]] | None = None
    nodeDimensions: dict[str, dict[str, float]] | None = None
    edges: list[FlowEdge] | None = None
    agents: list[AgentState] | None = None


class AgentCreateRequest(BaseModel):
    type: str
    position: dict[str, float] | None = None


class AgentUpdateRequest(BaseModel):
    title: str | None = None
    prompt: str | None = None
    config: dict[str, Any] | None = None
    position: dict[str, float] | None = None
    status: AgentStatus | None = None


class AgentRunRequest(BaseModel):
    agent_id: str | None = None
    agent_type: str | None = None
    config: dict[str, Any] | None = None
    prompt: str | None = None
    input_node_ids: list[str] = Field(default_factory=list)
    rough_finding_text: str = ""
    run_mode: Literal["append", "replace"] = "append"


class AgentRunResponse(BaseModel):
    agent: AgentState
    generated: dict[str, Any] = Field(default_factory=dict)
    map: AuditMap


class AgentOutputItem(BaseModel):
    id: str
    type: str
    title: str


class AgentOutputConflict(BaseModel):
    input_node_id: str
    input_title: str
    outputs: list[AgentOutputItem] = Field(default_factory=list)


class AgentOutputCheckResponse(BaseModel):
    conflicts: list[AgentOutputConflict] = Field(default_factory=list)


class NodeUpdateRequest(BaseModel):
    node_type: str
    fields: dict[str, Any]


class BulkDeleteRequest(BaseModel):
    phase: Literal["planning", "fieldwork", "reporting"]
    dimension: str


class AutoLayoutRequest(BaseModel):
    horizontal_gap: float = 620
    vertical_gap: float = 50
    card_width: float = 560
    phase_gap: float = 160


class MessageResponse(BaseModel):
    message: str


Risk.model_rebuild()
Objective.model_rebuild()
