from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


SummaryMode = Literal["compact", "structured", "detailed"]
DetailMode = Literal["selected_full_related_summary", "all_summary", "full_with_limits"]
ContextDirection = Literal["upstream", "downstream", "both"]


class ContextBlockMetadata(BaseModel):
    item_count: int = 0
    truncated: bool = False
    summary_mode: SummaryMode = "compact"
    detail_mode: DetailMode = "selected_full_related_summary"
    notes: list[str] = Field(default_factory=list)


class ContextBlock(BaseModel):
    block_id: str
    title: str
    content: dict[str, Any] = Field(default_factory=dict)
    metadata: ContextBlockMetadata = Field(default_factory=ContextBlockMetadata)


class ContextRecipe(BaseModel):
    recipe_id: str
    agent_id: str
    blocks: list[str]
    relationship_depth: int = 1
    direction: ContextDirection = "both"
    relationship_types: list[str] | None = None
    exclude_item_types: list[str] = Field(default_factory=lambda: ["agent"])
    item_type_filters: list[str] | None = None
    max_items_per_type: int = 20
    summary_mode: SummaryMode = "compact"
    detail_mode: DetailMode = "selected_full_related_summary"
    max_context_tokens: int = 6000


class ContextOptions(BaseModel):
    relationship_depth: int | None = None
    direction: ContextDirection | None = None
    relationship_types: list[str] | None = None
    exclude_item_types: list[str] | None = None
    item_type_filters: list[str] | None = None
    max_items_per_type: int | None = None
    summary_mode: SummaryMode | None = None
    detail_mode: DetailMode | None = None
    max_context_tokens: int | None = None


class ContextPackSummary(BaseModel):
    audit_title: str = ""
    phase: str = ""
    selected_item_count: int = 0
    related_item_count: int = 0
    blocks: list[str] = Field(default_factory=list)
    recipe_id: str = ""
    fallback_recipe: bool = False


class ContextPackLimits(BaseModel):
    max_context_tokens: int
    estimated_tokens: int
    truncated: bool = False
    max_items_per_type: int
    relationship_depth: int
    summary_mode: SummaryMode
    detail_mode: DetailMode


class ContextPack(BaseModel):
    agent_id: str
    agent_type: str = ""
    recipe_id: str
    context_summary: ContextPackSummary
    blocks: list[ContextBlock]
    limits: ContextPackLimits
    rendered_context: str


class ContextPreviewRequest(BaseModel):
    selected_item_ids: list[str] = Field(default_factory=list)
    context_options: ContextOptions = Field(default_factory=ContextOptions)
