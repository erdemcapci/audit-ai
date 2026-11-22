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


class DataQualityRunContent(BaseModel):
    """Engine output. Its inner structure is owned by the frontend engine and stored as-is."""

    engine_version: int = 1
    settings: dict[str, Any] = Field(default_factory=dict)
    plan: list[dict[str, Any]] = Field(default_factory=list)
    profile: dict[str, Any] = Field(default_factory=dict)
    steps: list[dict[str, Any]] = Field(default_factory=list)
    results: list[dict[str, Any]] = Field(default_factory=list)
    report_markdown: str = ""


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


class StoredSourceFile(BaseModel):
    content_hash: str
    compressed_size: int
    size: int
