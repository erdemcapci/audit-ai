"""Existing canvas agent definitions for this capability."""
from app.models import AgentDefinition


AGENT_DEFINITIONS: dict[str, AgentDefinition] = {
    "report_draft_agent": AgentDefinition(
        type="report_draft_agent",
        title="Report Draft Agent",
        description="Drafts report content from the full audit state.",
        default_prompt="You are an internal audit report drafting assistant. Generate executive-ready report language from the full audit plan, fieldwork, and findings. Return valid JSON only.",
        default_config={"output_mode": "json", "report_style": "executive"},
        allowed_input_node_types=[],
        output_node_types=["reportNode"],
    ),
}
