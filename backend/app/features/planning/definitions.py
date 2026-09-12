"""Existing canvas agent definitions for this capability."""
from app.models import AgentDefinition


AGENT_DEFINITIONS: dict[str, AgentDefinition] = {
    "workstream_generator": AgentDefinition(
        type="workstream_generator",
        title="Workstream Generator",
        description="Generates audit workstreams from the audit description.",
        default_prompt="You are an internal audit planning assistant. Consider the existing audit map and generate workstreams that improve coverage of important audit areas without overlapping existing workstreams. Return valid JSON only.",
        default_config={"output_mode": "json", "max_output_items": 6, "workstreams_count": 5},
        allowed_input_node_types=["auditNode"],
        output_node_types=["workstreamNode"],
    ),
    "objective_generator": AgentDefinition(
        type="objective_generator",
        title="Objective Generator",
        description="Generates audit objectives for connected workstreams.",
        default_prompt="You are an internal audit planning assistant. Consider existing objectives in the connected workstream and across the audit map. Generate objectives that fill coverage gaps and avoid overlapping existing objective angles. Return valid JSON only.",
        default_config={"output_mode": "json", "max_output_items": 8, "objectives_per_workstream": 2},
        allowed_input_node_types=["workstreamNode"],
        output_node_types=["objectiveNode"],
    ),
    "risk_generator": AgentDefinition(
        type="risk_generator",
        title="Risk Generator",
        description="Generates audit risks for connected objectives.",
        default_prompt="You are an internal audit planning assistant. Consider existing risks under the connected objective and related workstream. Generate additional risks that improve coverage of material risk areas without repeating existing risk themes. Return valid JSON only.",
        default_config={"output_mode": "json", "max_output_items": 10, "risks_per_objective": 2},
        allowed_input_node_types=["objectiveNode"],
        output_node_types=["riskNode"],
    ),
    "test_generator": AgentDefinition(
        type="test_generator",
        title="Test Generator",
        description="Generates audit tests for connected risks.",
        default_prompt="You are an internal audit planning assistant. Consider existing tests under the connected risk and related objective. Generate tests that complement existing procedures and cover untested assertions or evidence sources. Return valid JSON only.",
        default_config={
            "output_mode": "json",
            "max_output_items": 12,
            "tests_per_risk": 2,
            "allowed_test_types": ["Test of Design", "Detailed Test"],
        },
        allowed_input_node_types=["riskNode"],
        output_node_types=["testNode"],
    ),
}
