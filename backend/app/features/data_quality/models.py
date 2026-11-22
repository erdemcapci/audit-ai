from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SourceFile(BaseModel):
    name: str
    size: int = 0
    rows: int = 0
    columns: int = 0
    headers: list[str] = Field(default_factory=list)
    content_hash: str = ""
    # Set by the server: whether the compressed copy of the file is still stored.
    stored: bool = False


class RunTotals(BaseModel):
    tests: int = 0
    findings: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    exceptions: int = 0
    uncertain: int = 0
    notHeld: int = 0


class DataQualityRunSummary(BaseModel):
    id: str
    created_at: str
    source: SourceFile
    totals: RunTotals = Field(default_factory=RunTotals)
    verdict: str = ""
    ai_used: bool = False
    # The AI's overall verdict on fitness for use, when the results were interpreted (Phase 4).
    ai_verdict: str = ""


class DataQualityRunContent(BaseModel):
    """Engine output. Its inner structure is owned by the frontend engine and stored as-is."""

    engine_version: int = 1
    settings: dict[str, Any] = Field(default_factory=dict)
    plan: list[dict[str, Any]] = Field(default_factory=list)
    profile: dict[str, Any] = Field(default_factory=dict)
    steps: list[dict[str, Any]] = Field(default_factory=list)
    results: list[dict[str, Any]] = Field(default_factory=list)
    report_markdown: str = ""
    # The AI test plan as applied to this run (Phase 3); None when AI was not used.
    ai_plan: dict[str, Any] | None = None
    # The AI interpretation of the results (Phase 4); None until requested.
    ai_interpretation: dict[str, Any] | None = None


class DataQualityRun(DataQualityRunSummary, DataQualityRunContent):
    pass


class DataQualityRunCreate(DataQualityRunContent):
    source: SourceFile
    totals: RunTotals = Field(default_factory=RunTotals)
    verdict: str = ""
    ai_used: bool = False


class SavedRule(BaseModel):
    """A rule test definition kept in the project for later runs. Its params are owned by the frontend engine."""

    id: str
    template: str = "rule"
    subject: str
    params: dict[str, Any]
    source: str
    reason: str = ""
    enabled: bool = True
    savedAt: str = ""


SEMANTIC_ROLES = [
    "record_id", "document_number", "party_id", "party_name", "amount", "quantity", "unit_price", "currency",
    "document_date", "posting_date", "due_date", "close_date", "status", "country", "cost_center", "account",
    "user", "description", "other",
]


class AiPlanColumn(BaseModel):
    name: str
    type: str
    blank_percent: float = 0
    distinct: int = 0
    unique_percent: float = 0
    top_values: list[str] = Field(default_factory=list)
    date_format: str = ""
    decimal: str = ""


class AiPlanTest(BaseModel):
    id: str
    template: str
    subject: str
    sentence: str
    enabled: bool
    source: str = "standard"


class AiPlanRequest(BaseModel):
    """Built by the browser engine: a profile summary, the proposed plan and a small sample of rows."""

    file_name: str
    rows: int
    columns: list[AiPlanColumn]
    relationships: list[str] = Field(default_factory=list)
    tests: list[AiPlanTest]
    sample_rows: list[list[str]] = Field(default_factory=list, max_length=50)


class AiColumnRole(BaseModel):
    column: str
    role: str
    meaning: str = ""


class AiTestChange(BaseModel):
    test_id: str
    reason: str


class AiNewRule(BaseModel):
    rule: dict[str, Any]
    reason: str


class AiIdea(BaseModel):
    idea: str
    reason: str = ""


class AiPlanResponse(BaseModel):
    summary: str = ""
    columns: list[AiColumnRole] = Field(default_factory=list)
    switch_off: list[AiTestChange] = Field(default_factory=list)
    switch_on: list[AiTestChange] = Field(default_factory=list)
    new_rules: list[AiNewRule] = Field(default_factory=list)
    not_testable: list[AiIdea] = Field(default_factory=list)
    provider: str = ""
    model: str = ""
    demo: bool = False
    log_run_id: str | None = None
    estimated_tokens: int = 0
    sample_rows_sent: int = 0


AI_VERDICTS = ["usable", "usable_with_conditions", "not_usable"]
AI_ACTIONS = ["ask_client", "exclude_records", "document_limitation", "investigate_in_fieldwork", "no_action"]
AI_SEVERITIES = ["high", "medium", "low"]


class AiCardInterpretation(BaseModel):
    card_id: str
    severity: str
    severity_reason: str = ""
    meaning: str = ""
    action: str = "no_action"
    action_text: str = ""
    unverified_numbers: list[str] = Field(default_factory=list)


class AiInterpretation(BaseModel):
    verdict: str
    summary: str = ""
    cards: list[AiCardInterpretation] = Field(default_factory=list)
    client_questions: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    # Numbers in the summary, questions or limitations that are not in the results sent to the AI.
    unverified_numbers: list[str] = Field(default_factory=list)
    provider: str = ""
    model: str = ""
    demo: bool = False
    log_run_id: str | None = None
    estimated_tokens: int = 0
    cards_sent: int = 0
    attempts: int = 1
    created_at: str = ""


class StoredSourceFile(BaseModel):
    content_hash: str
    compressed_size: int
    size: int
