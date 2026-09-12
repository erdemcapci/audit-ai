"""Existing canvas agent definitions for this capability."""
from app.models import AgentDefinition


AGENT_DEFINITIONS: dict[str, AgentDefinition] = {
    "finding_draft_agent": AgentDefinition(
        type="finding_draft_agent",
        title="Finding Draft Agent",
        description="Drafts a structured finding from connected fieldwork or rough text.",
        default_prompt="You are an internal audit finding drafting assistant. Turn rough fieldwork observations into a structured audit finding. Return valid JSON only.",
        default_config={"output_mode": "json", "tone": "internal audit"},
        allowed_input_node_types=["fieldworkItemNode"],
        output_node_types=["findingNode"],
    ),
}
