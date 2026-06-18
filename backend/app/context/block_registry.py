from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.context.models import ContextBlock, ContextRecipe
from app.models import AgentState
from app.services.audit_graph_service import AuditGraph, AuditGraphService


@dataclass(frozen=True)
class ContextBlockRequest:
    project_id: str
    agent: AgentState
    selected_item_ids: list[str]
    recipe: ContextRecipe
    graph: AuditGraph
    graph_service: AuditGraphService


class ContextBlockProvider(Protocol):
    block_id: str
    title: str

    def build(self, request: ContextBlockRequest) -> ContextBlock:
        ...


class ContextBlockRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, ContextBlockProvider] = {}

    def register(self, provider: ContextBlockProvider) -> None:
        self._providers[provider.block_id] = provider

    def get(self, block_id: str) -> ContextBlockProvider | None:
        return self._providers.get(block_id)

    def list_block_ids(self) -> list[str]:
        return sorted(self._providers)
