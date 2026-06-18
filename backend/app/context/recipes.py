from __future__ import annotations

from app.context.models import ContextOptions, ContextRecipe


GENERIC_RECIPE = ContextRecipe(
    recipe_id="generic_default",
    agent_id="generic",
    blocks=["audit_overview", "workflow_state", "selected_items", "traceability_chain", "connected_items", "existing_outputs"],
    relationship_depth=1,
    direction="both",
    max_items_per_type=20,
    summary_mode="compact",
    detail_mode="selected_full_related_summary",
    max_context_tokens=6000,
)


DEFAULT_RECIPES: dict[str, ContextRecipe] = {
    "workstream_generator": ContextRecipe(
        recipe_id="workstream_generator_default",
        agent_id="workstream_generator",
        blocks=["audit_overview", "workflow_state", "selected_items", "existing_outputs", "relationship_gaps"],
        relationship_depth=1,
        direction="downstream",
        max_items_per_type=20,
    ),
    "objective_generator": ContextRecipe(
        recipe_id="objective_generator_default",
        agent_id="objective_generator",
        blocks=["audit_overview", "workflow_state", "selected_items", "downstream_items", "existing_outputs"],
        relationship_depth=1,
        direction="downstream",
        max_items_per_type=20,
    ),
    "risk_generator": ContextRecipe(
        recipe_id="risk_generator_default",
        agent_id="risk_generator",
        blocks=["audit_overview", "workflow_state", "selected_items", "connected_items", "existing_outputs"],
        relationship_depth=2,
        direction="both",
        max_items_per_type=20,
    ),
    "test_generator": ContextRecipe(
        recipe_id="test_generator_default",
        agent_id="test_generator",
        blocks=["audit_overview", "workflow_state", "selected_items", "traceability_chain", "connected_items", "existing_outputs"],
        relationship_depth=2,
        direction="both",
        max_items_per_type=20,
    ),
    "interview_plan_generator": ContextRecipe(
        recipe_id="interview_plan_generator_default",
        agent_id="interview_plan_generator",
        blocks=["audit_overview", "selected_items", "traceability_chain", "existing_outputs"],
        relationship_depth=2,
        direction="both",
        max_items_per_type=24,
    ),
    "document_request_generator": ContextRecipe(
        recipe_id="document_request_generator_default",
        agent_id="document_request_generator",
        blocks=["audit_overview", "selected_items", "traceability_chain", "existing_outputs"],
        relationship_depth=2,
        direction="both",
        max_items_per_type=20,
    ),
    "finding_draft_agent": ContextRecipe(
        recipe_id="finding_draft_agent_default",
        agent_id="finding_draft_agent",
        blocks=["audit_overview", "selected_items", "traceability_chain", "upstream_items", "existing_outputs"],
        relationship_depth=3,
        direction="both",
        max_items_per_type=20,
        max_context_tokens=7000,
    ),
    "report_draft_agent": ContextRecipe(
        recipe_id="report_draft_agent_default",
        agent_id="report_draft_agent",
        blocks=["audit_overview", "workflow_state", "findings_summary", "reporting_summary", "relationship_gaps", "traceability_chain", "existing_outputs"],
        relationship_depth=3,
        direction="both",
        max_items_per_type=40,
        summary_mode="structured",
        detail_mode="all_summary",
        max_context_tokens=9000,
    ),
    "audit_quality_reviewer": ContextRecipe(
        recipe_id="audit_quality_reviewer_default",
        agent_id="audit_quality_reviewer",
        blocks=["audit_overview", "workflow_state", "planning_summary", "fieldwork_summary", "findings_summary", "reporting_summary", "relationship_gaps", "traceability_chain"],
        relationship_depth=3,
        direction="both",
        max_items_per_type=40,
        summary_mode="structured",
        detail_mode="all_summary",
        max_context_tokens=9000,
    ),
}


def get_context_recipe(agent_type: str) -> tuple[ContextRecipe, bool]:
    recipe = DEFAULT_RECIPES.get(agent_type)
    if recipe:
        return recipe.model_copy(deep=True), False
    fallback = GENERIC_RECIPE.model_copy(deep=True)
    fallback.agent_id = agent_type
    fallback.recipe_id = f"{agent_type}_fallback"
    return fallback, True


def apply_context_options(recipe: ContextRecipe, options: ContextOptions | dict | None) -> ContextRecipe:
    next_recipe = recipe.model_copy(deep=True)
    if options is None:
        return next_recipe
    parsed = options if isinstance(options, ContextOptions) else ContextOptions.model_validate(options)
    updates = parsed.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(next_recipe, key, value)
    next_recipe.relationship_depth = max(0, int(next_recipe.relationship_depth))
    next_recipe.max_items_per_type = max(1, int(next_recipe.max_items_per_type))
    next_recipe.max_context_tokens = max(500, int(next_recipe.max_context_tokens))
    next_recipe.exclude_item_types = list(dict.fromkeys(next_recipe.exclude_item_types or ["agent"]))
    if next_recipe.relationship_types is not None:
        next_recipe.relationship_types = list(dict.fromkeys(next_recipe.relationship_types))
    return next_recipe
