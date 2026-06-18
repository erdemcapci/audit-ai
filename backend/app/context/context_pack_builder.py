from __future__ import annotations

import json
from math import ceil
from typing import Any

from app.context.block_registry import ContextBlockRequest, ContextBlockRegistry
from app.context.blocks import default_context_block_registry
from app.context.models import ContextBlock, ContextPack, ContextPackLimits, ContextPackSummary
from app.context.recipes import apply_context_options, get_context_recipe
from app.models import AgentState
from app.services.audit_graph_service import AuditGraphService, audit_graph_service


class ContextPackBuilder:
    def __init__(
        self,
        graph_service: AuditGraphService | None = None,
        registry: ContextBlockRegistry | None = None,
    ) -> None:
        self.graph_service = graph_service or audit_graph_service
        self.registry = registry or default_context_block_registry()

    def build(
        self,
        project_id: str,
        agent: AgentState,
        selected_item_ids: list[str] | None = None,
        context_options: dict[str, Any] | None = None,
    ) -> ContextPack:
        base_recipe, fallback_recipe = get_context_recipe(agent.type)
        recipe = apply_context_options(base_recipe, context_options)
        graph = self.graph_service.build_graph(project_id)
        selected_ids = selected_item_ids or []
        block_request = ContextBlockRequest(
            project_id=project_id,
            agent=agent,
            selected_item_ids=selected_ids,
            recipe=recipe,
            graph=graph,
            graph_service=self.graph_service,
        )
        blocks: list[ContextBlock] = []
        for block_id in recipe.blocks:
            provider = self.registry.get(block_id)
            if not provider:
                blocks.append(self._missing_block(block_id))
                continue
            blocks.append(provider.build(block_request))

        rendered_context = self._render_context(agent, recipe.recipe_id, blocks)
        estimated_tokens = self._estimate_tokens(rendered_context)
        truncated = any(block.metadata.truncated for block in blocks)
        if estimated_tokens > recipe.max_context_tokens:
            rendered_context = self._truncate_rendered_context(rendered_context, recipe.max_context_tokens)
            estimated_tokens = self._estimate_tokens(rendered_context)
            truncated = True
            for block in blocks:
                if block.block_id != "audit_overview":
                    block.metadata.truncated = True
                    if "Final rendered context was truncated by max_context_tokens." not in block.metadata.notes:
                        block.metadata.notes.append("Final rendered context was truncated by max_context_tokens.")

        related_count = sum(block.metadata.item_count for block in blocks if block.block_id in {"connected_items", "upstream_items", "downstream_items", "traceability_chain"})
        summary = ContextPackSummary(
            audit_title=graph.audit.title,
            phase=self._phase_from_blocks(blocks),
            selected_item_count=len([item_id for item_id in selected_ids if item_id in graph.items]),
            related_item_count=related_count,
            blocks=[block.block_id for block in blocks],
            recipe_id=recipe.recipe_id,
            fallback_recipe=fallback_recipe,
        )
        limits = ContextPackLimits(
            max_context_tokens=recipe.max_context_tokens,
            estimated_tokens=estimated_tokens,
            truncated=truncated,
            max_items_per_type=recipe.max_items_per_type,
            relationship_depth=recipe.relationship_depth,
            summary_mode=recipe.summary_mode,
            detail_mode=recipe.detail_mode,
        )
        return ContextPack(
            agent_id=agent.id,
            agent_type=agent.type,
            recipe_id=recipe.recipe_id,
            context_summary=summary,
            blocks=blocks,
            limits=limits,
            rendered_context=rendered_context,
        )

    def _missing_block(self, block_id: str) -> ContextBlock:
        return ContextBlock(
            block_id=block_id,
            title=f"Missing Context Block: {block_id}",
            content={"error": "No context block provider is registered for this block."},
        )

    def _render_context(self, agent: AgentState, recipe_id: str, blocks: list[ContextBlock]) -> str:
        lines = [
            "# Audit Context Pack",
            "",
            f"Agent: {agent.title} ({agent.type})",
            f"Recipe: {recipe_id}",
            "",
        ]
        for block in blocks:
            lines.extend(
                [
                    f"## {block.title}",
                    "",
                    self._render_block_content(block),
                    "",
                ]
            )
        lines.append(self._instructions_section())
        return "\n".join(lines)

    def _render_block_content(self, block: ContextBlock) -> str:
        metadata = block.metadata.model_dump()
        return "\n".join(
            [
                f"- Block ID: `{block.block_id}`",
                f"- Items: {metadata['item_count']}",
                f"- Truncated: {metadata['truncated']}",
                "",
                "```json",
                json.dumps(block.content, indent=2),
                "```",
            ]
        )

    def _estimate_tokens(self, value: str) -> int:
        return ceil(len(value) / 4)

    def _truncate_rendered_context(self, value: str, max_context_tokens: int) -> str:
        max_chars = max_context_tokens * 4
        if len(value) <= max_chars:
            return value
        instructions = self._instructions_section()
        marker = "\n\n[Context truncated by max_context_tokens limit. Structured block metadata marks truncation.]\n\n"
        reserved = len(marker) + len(instructions)
        return value[: max(0, max_chars - reserved)].rstrip() + marker + instructions

    def _instructions_section(self) -> str:
        return "\n".join(
            [
                "## Instructions for Context Use",
                "",
                "Use this context to stay aligned with the audit scope.",
                "Respect existing relationships between objectives, risks, tests, fieldwork items, findings, and report sections.",
                "Avoid duplicating existing outputs.",
                "If context is incomplete, say what is missing instead of inventing relationships.",
            ]
        )

    def _phase_from_blocks(self, blocks: list[ContextBlock]) -> str:
        for block in blocks:
            if block.block_id == "workflow_state":
                phase = block.content.get("current_phase")
                if isinstance(phase, str):
                    return phase
        return ""


context_pack_builder = ContextPackBuilder()
