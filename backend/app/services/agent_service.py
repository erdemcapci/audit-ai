from copy import deepcopy
import json
import re
from typing import Any

from fastapi import HTTPException

from app.agents.json_utils import parse_or_warn
from app.agents.demo_data import demo_objectives, demo_report
from app.config import settings
from app.agents.finding_agent import FindingAgent
from app.agents.report_agent import report_to_markdown
from app.context.context_pack_builder import context_pack_builder
from app.context.models import ContextPack, ContextPreviewRequest
from app.llm.router import get_llm_provider
from app.models import (
    AgentCreateRequest,
    AgentDefinition,
    AgentOutputCheckResponse,
    AgentOutputConflict,
    AgentOutputItem,
    AgentRunRequest,
    AgentRunResponse,
    AgentState,
    AgentUpdateRequest,
    FlowEdge,
    FindingDraftRequest,
    MapState,
    NodeUpdateRequest,
    Objective,
    ReportState,
    Risk,
    Test,
    Workstream,
    utc_now,
)
from app.services.audit_map_service import SECTION_PADDING, anchored_fieldwork_section_layouts, audit_map_service
from app.services.audit_graph_service import audit_graph_service
from app.services.agent_run_log_service import agent_run_log_service
from app.store.project_store import project_store


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
    "finding_draft_agent": AgentDefinition(
        type="finding_draft_agent",
        title="Finding Draft Agent",
        description="Drafts a structured finding from connected fieldwork or rough text.",
        default_prompt="You are an internal audit finding drafting assistant. Turn rough fieldwork observations into a structured audit finding. Return valid JSON only.",
        default_config={"output_mode": "json", "tone": "internal audit"},
        allowed_input_node_types=["fieldworkItemNode"],
        output_node_types=["findingNode"],
    ),
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


def edge_id(source: str, target: str) -> str:
    return f"{source}->{target}"


def add_custom_edge(map_state: MapState, source: str, target: str, animated: bool = False) -> None:
    new_edge = FlowEdge(id=edge_id(source, target), source=source, target=target, animated=animated)
    if new_edge.id not in {item.id for item in map_state.edges}:
        map_state.edges.append(new_edge)


def normalize_theme(value: str) -> str:
    words = re.findall(r"[a-z0-9]+", value.lower())
    stop_words = {
        "a",
        "an",
        "and",
        "are",
        "assess",
        "audit",
        "control",
        "controls",
        "for",
        "in",
        "of",
        "or",
        "process",
        "review",
        "the",
        "to",
    }
    return " ".join(word for word in words if word not in stop_words)


def theme_is_covered(candidate: str, existing_titles: list[str]) -> bool:
    candidate_terms = set(normalize_theme(candidate).split())
    if not candidate_terms:
        return False
    for title in existing_titles:
        existing_terms = set(normalize_theme(title).split())
        if not existing_terms:
            continue
        overlap = candidate_terms & existing_terms
        if candidate_terms <= existing_terms or existing_terms <= candidate_terms or len(overlap) >= min(2, len(candidate_terms)):
            return True
    return False


def coverage_candidates(candidates: list, existing_titles: list[str], count: int) -> list:
    selected = []
    for candidate in candidates:
        title = candidate[0] if isinstance(candidate, tuple) else getattr(candidate, "name", getattr(candidate, "title", str(candidate)))
        if not theme_is_covered(str(title), existing_titles + [str(item[0] if isinstance(item, tuple) else getattr(item, "name", getattr(item, "title", str(item)))) for item in selected]):
            selected.append(candidate)
        if len(selected) >= count:
            return selected
    for candidate in candidates:
        if len(selected) >= count:
            return selected
        if candidate not in selected:
            selected.append(candidate)
    return selected


def prune_deleted_or_orphan_agents(map_state: MapState) -> None:
    deleted_agent_ids = set(map_state.deletedAgentIds)
    edge_agent_ids = {edge.source for edge in map_state.edges if edge.source.startswith("agent_")} | {edge.target for edge in map_state.edges if edge.target.startswith("agent_")}
    keep: list[AgentState] = []
    removed_ids: set[str] = set()
    seen_ids: set[str] = set()
    for agent in map_state.agents:
        if agent.type not in AGENT_DEFINITIONS:
            removed_ids.add(agent.id)
            continue
        if agent.id in deleted_agent_ids or agent.id in seen_ids:
            removed_ids.add(agent.id)
            continue
        seen_ids.add(agent.id)
        has_saved_position = agent.id in map_state.nodePositions
        has_edges = agent.id in edge_agent_ids
        has_run_state = agent.status != "idle" or bool(agent.last_run_at) or bool(agent.last_output)
        if not has_saved_position and not has_edges and not has_run_state:
            removed_ids.add(agent.id)
            continue
        keep.append(agent)
    if removed_ids:
        map_state.agents = keep
        map_state.edges = [edge for edge in map_state.edges if edge.source not in removed_ids and edge.target not in removed_ids]
        for agent_id in removed_ids:
            map_state.nodePositions.pop(agent_id, None)
            map_state.nodeDimensions.pop(agent_id, None)


def risk_catalog(objective: Objective) -> list[tuple[str, str, str]]:
    return [
        ("Control design does not address the objective", "The process may not include a clear control to address the stated audit objective.", "High"),
        ("Control execution is inconsistent", "Control owners may not perform the control consistently or retain evidence.", "Medium"),
        ("Exception identification and escalation are weak", "Exceptions may not be identified, escalated, resolved, or reported to management.", "Medium"),
        ("Evidence retention is incomplete", "Control evidence may not be retained in a way that supports auditability and management review.", "Medium"),
        ("Ownership and accountability are unclear", "Roles, handoffs, or decision rights may not be clear enough to ensure consistent process execution.", "Medium"),
        ("System configuration does not enforce the control", "Workflow, access, or system rules may not prevent bypass or inconsistent processing.", "High"),
        ("Monitoring does not detect issues timely", "Management reporting or monitoring may not identify trends, aged exceptions, or recurring control failures.", "Medium"),
        ("Data quality affects control reliability", "Incomplete, inaccurate, or stale data may reduce the effectiveness of the control activity.", "Medium"),
    ]


def risk_templates(index: int, objective: Objective, existing_titles: list[str]) -> Risk:
    catalog = coverage_candidates(risk_catalog(objective), existing_titles, index + 1)
    title, description, severity = catalog[index % len(catalog)]
    return Risk(
        title=f"{title}: {objective.title[:48]}",
        description=description,
        why_it_matters="This can reduce management's ability to rely on the process and detect issues promptly.",
        potential_impact="Operational errors, compliance gaps, financial misstatement, or unresolved exceptions.",
        severity=severity,
    )


def test_catalog(risk: Risk, allowed_types: list[str]) -> list[tuple[str, str, str, str]]:
    return [
        ("Evaluate control design", allowed_types[0] if allowed_types else "Test of Design", "Policy, control description, workflow design, RACI, and approval matrix.", "Confirm whether the control is designed to mitigate the risk."),
        ("Test operating evidence", allowed_types[1 % len(allowed_types)] if allowed_types else "Detailed Test", "Completed transactions, approval trail, review evidence, and exception logs.", "Validate whether the control operated consistently for selected items."),
        ("Inspect exception handling", "Detailed Test", "Exception register, escalation evidence, remediation actions, and management review records.", "Assess whether exceptions are identified, escalated, and resolved."),
        ("Reconcile system report to source records", "Analytical Review", "System extract, source population, reconciliation support, and variance explanations.", "Evaluate completeness and accuracy of the population used for control operation."),
        ("Review access or configuration settings", "Test of Design", "Configuration screenshots, access listings, workflow rules, and change history.", "Determine whether system settings support the intended control."),
        ("Analyze trends and recurring exceptions", "Analytical Review", "Trend report, exception aging, repeat offender analysis, and management dashboards.", "Identify patterns that may indicate control weakness."),
        ("Perform targeted sample of high-risk items", "Detailed Test", "High-value, unusual, late, manual, or override transaction support.", "Focus testing on transactions most likely to expose the risk."),
    ]


def test_templates(index: int, risk: Risk, allowed_types: list[str], agent_id: str, existing_titles: list[str]) -> Test:
    catalog = coverage_candidates(test_catalog(risk, allowed_types), existing_titles, index + 1)
    title, test_type, evidence, objective = catalog[index % len(catalog)]
    return Test(
        title=f"{title} for {risk.title[:46]}",
        test_type=test_type,
        test_objective=f"{objective} Related risk: {risk.title}.",
        description=f"Perform audit procedures addressing the risk that {risk.description.lower()}",
        expected_evidence=evidence,
        sample_considerations="Use a recent sample covering normal, exception, and higher-risk items where practical.",
        generated_by_agent_id=agent_id,
    )


def workstream_templates(title: str, description: str, count: int, existing_titles: list[str]) -> list[Workstream]:
    generated = demo_objectives(title, description).workstreams
    generic = [
        Workstream(name="Governance and Accountability", description="Review process ownership, decision rights, policies, and oversight.", rationale="Governance coverage helps frame accountability and management review expectations."),
        Workstream(name="System and Data Controls", description="Review key system rules, access, workflow configuration, and data quality.", rationale="System and data controls often determine whether process controls operate consistently."),
        Workstream(name="Exception Management", description="Review how exceptions are detected, escalated, remediated, and monitored.", rationale="Exception management coverage helps identify whether issues are visible and resolved timely."),
        Workstream(name="Reporting and Monitoring", description="Review management reporting, KPIs, dashboards, and trend monitoring.", rationale="Monitoring coverage helps assess whether management can identify recurring control concerns."),
    ]
    candidates = [Workstream(name=item.name, description=item.description, rationale=item.rationale) for item in generated] + generic
    return coverage_candidates(candidates, existing_titles, count)


def objective_templates(index: int, workstream: Workstream, existing_titles: list[str]) -> Objective:
    candidates = [
        f"Assess {workstream.name.lower()} control design",
        f"Evaluate {workstream.name.lower()} operating effectiveness",
        f"Review {workstream.name.lower()} evidence retention",
        f"Assess {workstream.name.lower()} exception management",
        f"Evaluate {workstream.name.lower()} ownership and accountability",
        f"Review {workstream.name.lower()} system and data dependencies",
        f"Assess {workstream.name.lower()} monitoring and reporting",
    ]
    selected = coverage_candidates(candidates, existing_titles, index + 1)
    title = selected[index % len(selected)]
    return Objective(
        title=title,
        description=f"Determine whether {workstream.name.lower()} controls are appropriately designed, evidenced, and operating as intended.",
        scope_notes=f"Focus on current procedures, key systems, approval paths, exception handling, and retained evidence for {workstream.name.lower()}.",
        rationale=f"{workstream.name} is included in scope and needs clear objectives before risks and tests are generated.",
    )


def get_agent_position(map_state: MapState, agent: AgentState) -> dict[str, float]:
    return map_state.nodePositions.get(agent.id, agent.position)


def avoid_overlap(position: dict[str, float], occupied: list[dict[str, float]], gap: float = 180) -> dict[str, float]:
    candidate = dict(position)
    while any(abs(candidate["x"] - item["x"]) < 240 and abs(candidate["y"] - item["y"]) < 150 for item in occupied):
        candidate["y"] += gap
    occupied.append(candidate)
    return candidate


def output_position(
    map_state: MapState,
    agent: AgentState,
    phase: str,
    column_x: float,
    index: int,
    occupied: list[dict[str, float]],
) -> dict[str, float]:
    layout = map_state.phaseLayouts[phase]
    agent_position = get_agent_position(map_state, agent)
    x = max(agent_position.get("x", layout.x + column_x) + 360, layout.x + column_x)
    y = max(agent_position.get("y", layout.y + 140) + index * 190, layout.y + 140)
    return avoid_overlap({"x": x, "y": y}, occupied)


class AgentService:
    def list_types(self) -> list[AgentDefinition]:
        return list(AGENT_DEFINITIONS.values())

    def create(self, project_id: str, request: AgentCreateRequest) -> AgentState:
        definition = AGENT_DEFINITIONS.get(request.type)
        if not definition:
            raise HTTPException(status_code=400, detail=f"Unsupported agent type: {request.type}")
        map_state = project_store.load_map_state(project_id)
        prune_deleted_or_orphan_agents(map_state)
        agent = AgentState(
            type=definition.type,
            title=definition.title,
            prompt=definition.default_prompt,
            config=deepcopy(definition.default_config),
            position=request.position or {"x": 360, "y": 240},
        )
        map_state.agents.append(agent)
        map_state.nodePositions[agent.id] = agent.position
        project_store.save_map_state(project_id, map_state)
        return agent

    def update(self, project_id: str, agent_id: str, request: AgentUpdateRequest) -> AgentState:
        map_state = project_store.load_map_state(project_id)
        agent = self._get_agent(map_state, agent_id)
        if request.title is not None:
            agent.title = request.title
        if request.prompt is not None:
            agent.prompt = request.prompt
        if request.config is not None:
            agent.config = self._sanitize_agent_config(request.config)
        if request.position is not None:
            agent.position = request.position
        if request.status is not None:
            agent.status = request.status
        project_store.save_map_state(project_id, map_state)
        return agent

    def delete(self, project_id: str, agent_id: str) -> None:
        map_state = project_store.load_map_state(project_id)
        if agent_id not in map_state.deletedAgentIds:
            map_state.deletedAgentIds.append(agent_id)
        map_state.agents = [agent for agent in map_state.agents if agent.id != agent_id]
        map_state.edges = [edge for edge in map_state.edges if edge.source != agent_id and edge.target != agent_id]
        map_state.nodePositions.pop(agent_id, None)
        map_state.nodeDimensions.pop(agent_id, None)
        project_store.save_map_state(project_id, map_state)

    def check_outputs(self, project_id: str, agent_id: str, request: AgentRunRequest) -> AgentOutputCheckResponse:
        map_state = project_store.load_map_state(project_id)
        agent = self._get_agent(map_state, agent_id)
        input_node_ids = self._resolve_agent_input_node_ids(project_id, map_state, agent, request.input_node_ids)
        return AgentOutputCheckResponse(conflicts=self._output_conflicts(project_id, agent, input_node_ids))

    def preview_context(self, project_id: str, agent_id: str, request: ContextPreviewRequest) -> ContextPack:
        map_state = project_store.load_map_state(project_id)
        agent = self._get_agent(map_state, agent_id)
        selected_item_ids = request.selected_item_ids or [edge.source for edge in map_state.edges if edge.target == agent.id]
        return context_pack_builder.build(project_id, agent, selected_item_ids, request.context_options.model_dump(exclude_none=True))

    async def run(self, project_id: str, agent_id: str, request: AgentRunRequest, actor_id: str = "local") -> AgentRunResponse:
        map_state = project_store.load_map_state(project_id)
        prune_deleted_or_orphan_agents(map_state)
        agent = self._get_agent(map_state, agent_id)
        agent.config = self._sanitize_agent_config(agent.config)
        if request.config is not None:
            agent.config = self._sanitize_agent_config(request.config)
        if request.prompt is not None:
            agent.prompt = request.prompt
        input_node_ids = self._resolve_agent_input_node_ids(project_id, map_state, agent, request.input_node_ids)
        agent.status = "running"
        agent.last_error = ""
        project_store.save_map_state(project_id, map_state)

        saved_prompt = agent.prompt
        temporary_content = request.temporary_content.strip()
        if temporary_content:
            agent.prompt = (
                f"{agent.prompt.strip()}\n\n"
                "Temporary run content for this execution only:\n"
                f"{temporary_content}"
            )

        run_id: str | None = None
        capture: dict[str, Any] = {"exchanges": []}
        try:
            context_pack = context_pack_builder.build(project_id, agent, input_node_ids, request.context_options)
            expected_provider, expected_model = self._current_provider_and_model()
            try:
                run_id = agent_run_log_service.start_run(
                    project_id=project_id,
                    actor_id=actor_id,
                    agent=agent,
                    provider=expected_provider,
                    model=expected_model,
                    selected_item_ids=input_node_ids,
                    context_recipe_id=context_pack.recipe_id,
                    context_blocks_used=context_pack.context_summary.blocks,
                    estimated_context_tokens=context_pack.limits.estimated_tokens,
                    context_truncated=context_pack.limits.truncated,
                    rendered_context=context_pack.rendered_context,
                )
            except Exception:
                run_id = None
            if not input_node_ids and agent.type != "report_draft_agent":
                raise ValueError("This agent has no inputs yet. Connect it to related cards first.")
            if request.run_mode == "replace":
                self._delete_agent_outputs(project_id, map_state, agent, input_node_ids)
            output_ids_before = set(self._completed_output_ids(project_id, agent, input_node_ids))
            generated = await self._run_agent(project_id, map_state, agent, input_node_ids, request, context_pack, capture)
            generated = {
                **generated,
                "context_metadata": {
                    "context_recipe_id": context_pack.recipe_id,
                    "context_blocks_used": context_pack.context_summary.blocks,
                    "selected_item_ids": input_node_ids,
                    "estimated_context_tokens": context_pack.limits.estimated_tokens,
                    "context_truncated": context_pack.limits.truncated,
                    "fallback_recipe": context_pack.context_summary.fallback_recipe,
                },
            }
            agent.prompt = saved_prompt
            agent.status = "completed"
            agent.last_run_at = utc_now()
            agent.last_output = generated
            output_ids_after = set(self._completed_output_ids(project_id, agent, input_node_ids))
            output_object_ids = sorted(output_ids_after - output_ids_before)
            if agent.type == "report_draft_agent" and not output_object_ids:
                output_object_ids = ["report-main"]
            try:
                agent_run_log_service.complete_run(
                    project_id,
                    run_id,
                    provider=str(capture.get("provider") or expected_provider),
                    model=str(capture.get("model") or expected_model),
                    output_object_ids=output_object_ids,
                    final_prompt=capture.get("exchanges", []),
                    parsed_output=generated,
                    raw_llm_response=capture.get("raw_responses", []),
                )
            except Exception:
                pass
        except Exception as exc:
            agent.prompt = saved_prompt
            agent.status = "error"
            agent.last_error = str(exc)
            try:
                agent_run_log_service.fail_run(
                    project_id,
                    run_id,
                    error_message=str(exc),
                    provider=str(capture.get("provider", "")),
                    model=str(capture.get("model", "")),
                    final_prompt=capture.get("exchanges", []),
                    raw_llm_response=capture.get("raw_responses", []),
                )
            except Exception:
                pass
            project_store.save_map_state(project_id, map_state)
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        project_store.save_map_state(project_id, map_state)
        return AgentRunResponse(agent=agent, generated=generated, map=audit_map_service.build(project_id))

    def delete_node(self, project_id: str, node_id: str) -> None:
        map_state = project_store.load_map_state(project_id)
        removed = self._delete_nodes(project_id, map_state, {node_id})
        if not removed:
            raise HTTPException(status_code=404, detail="Node not found or cannot be deleted")
        project_store.save_map_state(project_id, map_state)

    def delete_outputs(self, project_id: str, node_id: str) -> dict[str, int]:
        map_state = project_store.load_map_state(project_id)
        output_ids = self._output_ids_for_node(project_id, map_state, node_id)
        removed = self._delete_nodes(project_id, map_state, output_ids)
        project_store.save_map_state(project_id, map_state)
        return {"deleted": removed}

    def delete_dimension(self, project_id: str, phase: str, dimension: str) -> dict[str, int]:
        map_state = project_store.load_map_state(project_id)
        node_ids = self._node_ids_for_dimension(project_id, map_state, phase, dimension)
        removed = self._delete_nodes(project_id, map_state, node_ids)
        project_store.save_map_state(project_id, map_state)
        return {"deleted": removed}

    def update_node(self, project_id: str, node_id: str, request: NodeUpdateRequest) -> None:
        if request.node_type == "phaseNode":
            map_state = project_store.load_map_state(project_id)
            phase = node_id.replace("phase-", "")
            if phase not in map_state.phaseLayouts:
                raise HTTPException(status_code=404, detail="Phase not found")
            layout = map_state.phaseLayouts[phase]
            for field in ["x", "y", "width", "height"]:
                if field in request.fields:
                    setattr(layout, field, float(request.fields[field]))
            project_store.save_map_state(project_id, map_state)
            return

        audit = project_store.get_project(project_id)
        if node_id == audit.id:
            for field in ["title", "description", "process_area", "initial_concern", "extra_context"]:
                if field in request.fields:
                    setattr(audit, field, request.fields[field])
            project_store.save_project(audit)
            return

        planning = project_store.load_planning(project_id)
        for workstream in planning.workstreams:
            if node_id == workstream.id:
                for field, target in [("title", "name"), ("description", "description"), ("rationale", "rationale")]:
                    if field in request.fields:
                        setattr(workstream, target, request.fields[field])
                workstream.status = "Edited"
                project_store.save_planning(project_id, planning)
                return
            for objective in workstream.objectives:
                if node_id == objective.id:
                    for field in ["title", "description", "rationale", "scope_notes"]:
                        if field in request.fields:
                            setattr(objective, field, request.fields[field])
                    objective.status = "Edited"
                    project_store.save_planning(project_id, planning)
                    return
                for risk in objective.risks:
                    if node_id == risk.id:
                        for field in ["title", "description", "why_it_matters", "potential_impact", "severity"]:
                            if field in request.fields:
                                setattr(risk, field, request.fields[field])
                        risk.status = "Edited"
                        project_store.save_planning(project_id, planning)
                        return
                    for test in risk.tests:
                        if node_id == test.id:
                            for field in ["title", "test_type", "test_objective", "description", "expected_evidence", "sample_considerations"]:
                                if field in request.fields:
                                    setattr(test, field, request.fields[field])
                            test.status = "Edited"
                            project_store.save_planning(project_id, planning)
                            return

        fieldwork = project_store.load_fieldwork(project_id)
        for item in fieldwork.items:
            if node_id == item.id:
                for field in ["title", "test_type", "description", "expected_evidence", "status", "notes", "evidence_placeholder"]:
                    if field in request.fields:
                        setattr(item, field, request.fields[field])
                project_store.save_fieldwork(project_id, fieldwork)
                return

        findings = project_store.load_findings(project_id)
        for finding in findings.findings:
            if node_id == finding.id:
                for field in ["title", "issue", "criteria", "root_cause", "impact", "recommendation", "management_action", "severity"]:
                    if field in request.fields:
                        setattr(finding, field, request.fields[field])
                finding.status = "Edited"
                project_store.save_findings(project_id, findings)
                return

        report = project_store.load_report(project_id)
        if node_id in {"report-main", "executive-summary"}:
            for field in ["executive_summary", "audit_conclusion", "issue_summary", "ai_improved_version", "draft_markdown"]:
                if field in request.fields:
                    setattr(report, field, request.fields[field])
            if "title" in request.fields or "description" in request.fields:
                report.executive_summary = request.fields.get("description", report.executive_summary)
            project_store.save_report(project_id, report)
            return

        raise HTTPException(status_code=404, detail="Node not found")

    def _output_conflicts(self, project_id: str, agent: AgentState, input_node_ids: list[str]) -> list[AgentOutputConflict]:
        if agent.type == "report_draft_agent":
            report = project_store.load_report(project_id)
            if report.executive_summary or report.audit_conclusion or report.issue_summary or report.draft_markdown:
                return [
                    AgentOutputConflict(
                        input_node_id=agent.id,
                        input_title="Full audit report",
                        outputs=[AgentOutputItem(id="report-main", type="reportNode", title="Draft Report")],
                    )
                ]
            return []
        conflicts: list[AgentOutputConflict] = []
        for input_id in input_node_ids:
            input_title = self._node_title(project_id, input_id)
            outputs = [AgentOutputItem(**item) for item in self._outputs_for_agent_input(project_id, agent, input_id)]
            if outputs:
                conflicts.append(AgentOutputConflict(input_node_id=input_id, input_title=input_title, outputs=outputs))
        return conflicts

    def _outputs_for_agent_input(self, project_id: str, agent: AgentState, input_id: str) -> list[dict[str, str]]:
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        if agent.type == "workstream_generator" and input_id == audit.id:
            return [{"id": ws.id, "type": "workstreamNode", "title": ws.name} for ws in planning.workstreams]
        if agent.type == "objective_generator":
            for workstream in planning.workstreams:
                if workstream.id == input_id:
                    return [{"id": objective.id, "type": "objectiveNode", "title": objective.title} for objective in workstream.objectives]
        if agent.type == "risk_generator":
            for workstream in planning.workstreams:
                for objective in workstream.objectives:
                    if objective.id == input_id:
                        return [{"id": risk.id, "type": "riskNode", "title": risk.title} for risk in objective.risks]
        if agent.type == "test_generator":
            for workstream in planning.workstreams:
                for objective in workstream.objectives:
                    for risk in objective.risks:
                        if risk.id == input_id:
                            return [{"id": test.id, "type": "testNode", "title": test.title} for test in risk.tests]
        if agent.type == "finding_draft_agent":
            fieldwork = project_store.load_fieldwork(project_id)
            findings = project_store.load_findings(project_id)
            item = next((candidate for candidate in fieldwork.items if candidate.id == input_id), None)
            if item:
                return [{"id": finding.id, "type": "findingNode", "title": finding.title} for finding in findings.findings if finding.id in item.finding_ids]
        if agent.type == "report_draft_agent":
            report = project_store.load_report(project_id)
            if report.executive_summary or report.audit_conclusion or report.issue_summary or report.draft_markdown:
                return [{"id": "report-main", "type": "reportNode", "title": "Draft Report"}]
        return []

    def _node_title(self, project_id: str, node_id: str) -> str:
        audit = project_store.get_project(project_id)
        if audit.id == node_id:
            return audit.title
        planning = project_store.load_planning(project_id)
        for workstream in planning.workstreams:
            if workstream.id == node_id:
                return workstream.name
            for objective in workstream.objectives:
                if objective.id == node_id:
                    return objective.title
                for risk in objective.risks:
                    if risk.id == node_id:
                        return risk.title
                    for test in risk.tests:
                        if test.id == node_id:
                            return test.title
        fieldwork = project_store.load_fieldwork(project_id)
        for item in fieldwork.items:
            if item.id == node_id:
                return item.title
        findings = project_store.load_findings(project_id)
        for finding in findings.findings:
            if finding.id == node_id:
                return finding.title
        return node_id

    def _delete_agent_outputs(self, project_id: str, map_state: MapState, agent: AgentState, input_node_ids: list[str]) -> int:
        if agent.type == "report_draft_agent":
            return self._delete_nodes(project_id, map_state, {"report-main", "executive-summary"})
        output_ids: set[str] = set()
        for input_id in input_node_ids:
            for item in self._outputs_for_agent_input(project_id, agent, input_id):
                output_ids.add(item["id"])
        return self._delete_nodes(project_id, map_state, output_ids)

    def _output_ids_for_node(self, project_id: str, map_state: MapState, node_id: str) -> set[str]:
        agent_by_id = {agent.id: agent for agent in map_state.agents}
        output_ids: set[str] = set()
        for edge in map_state.edges:
            if edge.source != node_id:
                continue
            if edge.target in agent_by_id:
                for item in self._outputs_for_agent_input(project_id, agent_by_id[edge.target], node_id):
                    output_ids.add(item["id"])
            else:
                output_ids.add(edge.target)
        planning = project_store.load_planning(project_id)
        for workstream in planning.workstreams:
            if workstream.id == node_id:
                output_ids.update(objective.id for objective in workstream.objectives)
            for objective in workstream.objectives:
                if objective.id == node_id:
                    output_ids.update(risk.id for risk in objective.risks)
                for risk in objective.risks:
                    if risk.id == node_id:
                        output_ids.update(test.id for test in risk.tests)
        fieldwork = project_store.load_fieldwork(project_id)
        for item in fieldwork.items:
            if item.id == node_id:
                output_ids.update(item.finding_ids)
        return output_ids

    def _node_ids_for_dimension(self, project_id: str, map_state: MapState, phase: str, dimension: str) -> set[str]:
        node_ids: set[str] = set()
        planning = project_store.load_planning(project_id)

        if phase == "planning":
            for workstream in planning.workstreams:
                if dimension in {"planning_all", "workstreamNode"}:
                    node_ids.add(workstream.id)
                for objective in workstream.objectives:
                    if dimension in {"objectiveNode"}:
                        node_ids.add(objective.id)
                    for risk in objective.risks:
                        if dimension in {"riskNode"}:
                            node_ids.add(risk.id)
                        if dimension == "testNode":
                            node_ids.update(test.id for test in risk.tests)

        if phase == "fieldwork":
            fieldwork = project_store.load_fieldwork(project_id)
            if dimension in {"fieldwork_all", "fieldworkItemNode"}:
                node_ids.update(item.id for item in fieldwork.items)

            findings = project_store.load_findings(project_id)
            if dimension in {"fieldwork_all", "findingNode"}:
                node_ids.update(finding.id for finding in findings.findings)

        if phase == "reporting" and dimension in {"reporting_all", "reportNode"}:
            node_ids.update({"report-main", "executive-summary"})

        if dimension == "agentNode":
            node_ids.update(agent.id for agent in map_state.agents if self._agent_phase(agent, map_state) == phase)

        if not node_ids and dimension not in {
            "planning_all",
            "workstreamNode",
            "objectiveNode",
            "riskNode",
            "testNode",
            "fieldwork_all",
            "fieldworkItemNode",
            "findingNode",
            "reporting_all",
            "reportNode",
            "agentNode",
        }:
            raise HTTPException(status_code=400, detail=f"Unsupported delete dimension: {dimension}")
        return node_ids

    def _agent_phase(self, agent: AgentState, map_state: MapState) -> str:
        if agent.type == "finding_draft_agent":
            return "fieldwork"
        if agent.type == "report_draft_agent":
            return "reporting"
        position = map_state.nodePositions.get(agent.id, agent.position)
        x = position.get("x", agent.position.get("x", 0))
        layouts = map_state.phaseLayouts
        if x >= layouts["reporting"].x:
            return "reporting"
        if x >= layouts["fieldwork"].x:
            return "fieldwork"
        return "planning"

    def _delete_nodes(self, project_id: str, map_state: MapState, node_ids: set[str]) -> int:
        if not node_ids:
            return 0
        removed: set[str] = set()

        planning = project_store.load_planning(project_id)
        for workstream in list(planning.workstreams):
            if workstream.id in node_ids:
                removed.update(self._collect_workstream_ids(workstream))
                planning.workstreams.remove(workstream)
                continue
            for objective in list(workstream.objectives):
                if objective.id in node_ids:
                    removed.update(self._collect_objective_ids(objective))
                    workstream.objectives.remove(objective)
                    continue
                for risk in list(objective.risks):
                    if risk.id in node_ids:
                        removed.update(self._collect_risk_ids(risk))
                        objective.risks.remove(risk)
                        continue
                    for test in list(risk.tests):
                        if test.id in node_ids:
                            removed.add(test.id)
                            risk.tests.remove(test)
        if removed:
            project_store.save_planning(project_id, planning)

        fieldwork = project_store.load_fieldwork(project_id)
        fieldwork_removed = False
        for item in list(fieldwork.items):
            if item.id in node_ids:
                removed.add(item.id)
                fieldwork.items.remove(item)
                fieldwork_removed = True
            else:
                before = len(item.finding_ids)
                item.finding_ids = [finding_id for finding_id in item.finding_ids if finding_id not in node_ids]
                fieldwork_removed = fieldwork_removed or before != len(item.finding_ids)
        if fieldwork_removed:
            project_store.save_fieldwork(project_id, fieldwork)

        findings = project_store.load_findings(project_id)
        removed_finding_ids = {finding.id for finding in findings.findings if finding.id in node_ids}
        before_findings = len(findings.findings)
        findings.findings = [finding for finding in findings.findings if finding.id not in node_ids]
        removed.update(removed_finding_ids)
        if before_findings != len(findings.findings):
            project_store.save_findings(project_id, findings)

        report_node_ids = {"report-main", "executive-summary"} & node_ids
        if report_node_ids:
            report = project_store.load_report(project_id)
            report.executive_summary = ""
            report.audit_conclusion = ""
            report.key_themes = []
            report.issue_summary = ""
            report.management_attention_points = []
            report.draft_report_structure = []
            report.ai_improved_version = ""
            project_store.save_report(project_id, report)
            removed.update(report_node_ids)

        removed_agent_ids = {node_id for node_id in node_ids if node_id.startswith("agent_")}
        for agent_id in removed_agent_ids:
            if agent_id not in map_state.deletedAgentIds:
                map_state.deletedAgentIds.append(agent_id)
        map_state.agents = [agent for agent in map_state.agents if agent.id not in node_ids]
        removed.update(removed_agent_ids)
        all_removed = removed | node_ids
        map_state.edges = [edge for edge in map_state.edges if edge.source not in all_removed and edge.target not in all_removed]
        for node_id in all_removed:
            map_state.nodePositions.pop(node_id, None)
            map_state.nodeDimensions.pop(node_id, None)
        return len(removed)

    def _collect_workstream_ids(self, workstream) -> set[str]:
        ids = {workstream.id}
        for objective in workstream.objectives:
            ids.update(self._collect_objective_ids(objective))
        return ids

    def _collect_objective_ids(self, objective) -> set[str]:
        ids = {objective.id}
        for risk in objective.risks:
            ids.update(self._collect_risk_ids(risk))
        return ids

    def _collect_risk_ids(self, risk) -> set[str]:
        ids = {risk.id}
        ids.update(test.id for test in risk.tests)
        return ids

    async def _run_agent(
        self,
        project_id: str,
        map_state: MapState,
        agent: AgentState,
        input_node_ids: list[str],
        request: AgentRunRequest,
        context_pack: ContextPack,
        capture: dict[str, Any],
    ) -> dict:
        if agent.type == "workstream_generator":
            return await self._run_workstream_generator(project_id, map_state, agent, input_node_ids, context_pack, capture)

        if agent.type == "objective_generator":
            return await self._run_objective_generator(project_id, map_state, agent, input_node_ids, context_pack, capture)

        if agent.type == "risk_generator":
            return await self._run_risk_generator(project_id, map_state, agent, input_node_ids, context_pack, capture)

        if agent.type == "test_generator":
            return await self._run_test_generator(project_id, map_state, agent, input_node_ids, context_pack, capture)

        if agent.type == "finding_draft_agent":
            audit = project_store.get_project(project_id)
            fieldwork = project_store.load_fieldwork(project_id)
            findings = project_store.load_findings(project_id)
            items = [candidate for candidate in fieldwork.items if candidate.id in input_node_ids]
            if not items:
                raise ValueError("Connect at least one fieldwork test card before running this agent.")
            issues_layout = anchored_fieldwork_section_layouts(map_state.phaseLayouts["fieldwork"], map_state)["issues"]
            existing_issue_positions = [
                position for finding_item in findings.findings if (position := map_state.nodePositions.get(finding_item.id))
            ]
            y = issues_layout.y + SECTION_PADDING["top"]
            generated = 0
            for item in items:
                raw_description = request.rough_finding_text or "Fieldwork exception requires follow-up."
                if request.temporary_content.strip():
                    raw_description = f"{raw_description}\n\nTemporary run content:\n{request.temporary_content.strip()}"
                finding = await FindingAgent().run(
                    audit,
                    FindingDraftRequest(
                        raw_description=raw_description,
                        fieldwork_item_id=item.id,
                    ),
                    item,
                    context_pack,
                    capture,
                )
                findings.findings.append(finding)
                item.finding_ids.append(finding.id)
                item.status = "Issue Identified"
                add_custom_edge(map_state, item.id, agent.id)
                add_custom_edge(map_state, agent.id, finding.id)
                while any(abs(y - position.get("y", 0)) < 160 for position in existing_issue_positions):
                    y += 170
                position = {"x": issues_layout.x + SECTION_PADDING["left"], "y": y}
                existing_issue_positions.append(position)
                map_state.nodePositions[finding.id] = position
                y += 170
                generated += 1
            project_store.save_fieldwork(project_id, fieldwork)
            project_store.save_findings(project_id, findings)
            return {"findings": generated}

        if agent.type == "report_draft_agent":
            if settings.demo_mode:
                report = demo_report()
            else:
                data = await self._agent_json(
                    agent,
                    "Generate substantive report content from the current audit materials. Do not return empty strings or empty arrays when audit materials are available.",
                    {
                        "report_style": agent.config.get("report_style", "executive"),
                        "available_context_blocks": context_pack.context_summary.blocks,
                        "report_instruction": "Use the audit context pack as the source of planning, fieldwork, findings, relationship gaps, and existing report content.",
                    },
                    {
                        "executive_summary": "Executive summary text",
                        "audit_conclusion": "Conclusion text",
                        "key_themes": ["Theme"],
                        "issue_summary": "Issue summary text",
                        "management_attention_points": ["Management action"],
                        "draft_report_structure": [{"heading": "Section", "content": "Section content"}],
                        "ai_improved_version": "Improved report language",
                        "draft_markdown": "Optional full markdown report",
                    },
                    context_pack,
                    capture,
                )
                report = self._report_from_agent_data(data)
            project_store.save_report(project_id, report)
            add_custom_edge(map_state, agent.id, "report-main")
            return {"report": 1}

        raise ValueError(f"Unsupported agent type: {agent.type}")

    def _sanitize_agent_config(self, config: dict) -> dict:
        next_config = dict(config)
        next_config.pop("llm_model", None)
        next_config.pop("temperature", None)
        return next_config

    def _current_provider_and_model(self) -> tuple[str, str]:
        if settings.demo_mode:
            return "demo", "deterministic"
        if settings.llm_provider == "openai":
            return "openai", settings.openai_model
        if settings.llm_provider == "claude":
            return "claude", settings.anthropic_model
        return "ollama", settings.ollama_model

    def _resolve_agent_input_node_ids(
        self,
        project_id: str,
        map_state: MapState,
        agent: AgentState,
        requested_input_node_ids: list[str] | None,
    ) -> list[str]:
        requested = self._dedupe(requested_input_node_ids or [])
        connected = self._dedupe(edge.source for edge in map_state.edges if edge.target == agent.id)
        if not AGENT_DEFINITIONS[agent.type].allowed_input_node_types:
            return requested

        requested_valid = self._filter_allowed_agent_inputs(project_id, agent, requested)
        if requested_valid:
            return requested_valid
        return self._filter_allowed_agent_inputs(project_id, agent, connected)

    def _filter_allowed_agent_inputs(self, project_id: str, agent: AgentState, input_node_ids: list[str]) -> list[str]:
        allowed_types = set(AGENT_DEFINITIONS[agent.type].allowed_input_node_types)
        if not allowed_types:
            return input_node_ids
        node_types = {node.id: node.type for node in audit_map_service.build(project_id).nodes}
        return [node_id for node_id in input_node_ids if node_types.get(node_id) in allowed_types]

    def _dedupe(self, values) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            result.append(value)
        return result

    def _completed_output_ids(self, project_id: str, agent: AgentState, input_node_ids: list[str]) -> list[str]:
        if agent.type == "report_draft_agent":
            return ["report-main"]
        output_ids: list[str] = []
        for input_id in input_node_ids:
            output_ids.extend(item["id"] for item in self._outputs_for_agent_input(project_id, agent, input_id))
        return sorted(set(output_ids))

    async def _agent_json(
        self,
        agent: AgentState,
        task: str,
        context: dict,
        response_shape: dict,
        context_pack: ContextPack | None = None,
        capture: dict[str, Any] | None = None,
    ) -> dict:
        system_prompt = (
            f"{agent.prompt.strip()}\n\n"
            "You are running as a configurable internal audit map agent. "
            "Follow the user's agent instructions exactly when they affect level of detail, tone, or output content. "
            "Use Global Audit Knowledge for broad awareness and Current Task for focus. "
            "Return valid JSON only. Do not include markdown, comments, or explanatory prose."
        )
        user_prompt = self._render_llm_request(context_pack, task, context, response_shape)
        response = await get_llm_provider().generate(
            system_prompt,
            user_prompt,
            json_mode=True,
            temperature=0.2,
        )
        if capture is not None:
            capture["provider"] = response.provider
            capture["model"] = response.model
            capture.setdefault("exchanges", []).append({"system_prompt": system_prompt, "user_prompt": user_prompt})
            capture.setdefault("raw_responses", []).append(response.raw_response)
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        return data

    def _render_llm_request(self, context_pack: ContextPack | None, task: str, context: dict, response_shape: dict) -> str:
        lines: list[str] = []
        if context_pack:
            lines.append(context_pack.rendered_context)
        else:
            lines.extend(["# Audit Context Pack", "", "No context pack was provided."])
        lines.extend(
            [
                "",
                "## Task Instruction",
                "",
                task,
                "",
                "## Task Parameters",
                "",
                "```json",
                json.dumps(context, indent=2),
                "```",
                "",
                "## Output Contract",
                "",
                "Return valid JSON matching this shape:",
                "",
                "```json",
                json.dumps(response_shape, indent=2),
                "```",
            ]
        )
        return "\n".join(lines)

    def _report_from_agent_data(self, data: dict) -> ReportState:
        draft_markdown = self._first_text(data, ["draft_markdown", "report_markdown", "markdown", "report", "content"])
        report = ReportState(
            executive_summary=self._first_text(data, ["executive_summary", "summary"]),
            audit_conclusion=self._first_text(data, ["audit_conclusion", "conclusion"]),
            key_themes=self._text_list(data.get("key_themes") or data.get("themes")),
            issue_summary=self._first_text(data, ["issue_summary", "findings_summary"]),
            management_attention_points=self._text_list(data.get("management_attention_points") or data.get("attention_points") or data.get("recommendations")),
            draft_report_structure=self._report_sections(data.get("draft_report_structure") or data.get("sections")),
            ai_improved_version=self._first_text(data, ["ai_improved_version", "improved_version"]),
            draft_markdown=draft_markdown,
        )
        if not report.draft_markdown.strip():
            report.draft_markdown = report_to_markdown(report)
        if not self._report_has_content(report):
            raise ValueError("The model returned an empty draft report. Try a stronger local model or add temporary run content.")
        return report

    def _report_has_content(self, report: ReportState) -> bool:
        meaningful = [
            report.executive_summary,
            report.audit_conclusion,
            report.issue_summary,
            report.ai_improved_version,
            *report.key_themes,
            *report.management_attention_points,
        ]
        meaningful.extend(str(section.get("content", "")) for section in report.draft_report_structure)
        if any(value.strip() for value in meaningful):
            return True
        return bool(report.draft_markdown.strip() and report.draft_markdown.strip() != "# Draft Audit Report")

    def _first_text(self, data: dict, keys: list[str]) -> str:
        for key in keys:
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def _text_list(self, value: object) -> list[str]:
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []

    def _report_sections(self, value: object) -> list[dict]:
        if not isinstance(value, list):
            return []
        sections: list[dict] = []
        for index, item in enumerate(value, start=1):
            if isinstance(item, dict):
                heading = str(item.get("heading") or item.get("title") or f"Section {index}").strip()
                content = str(item.get("content") or item.get("body") or item.get("text") or "").strip()
            else:
                heading = f"Section {index}"
                content = str(item).strip()
            if content:
                sections.append({"heading": heading or f"Section {index}", "content": content})
        return sections

    def _node_context(self, project_id: str, node_id: str) -> dict:
        audit = project_store.get_project(project_id)
        if audit.id == node_id:
            return {"id": audit.id, "type": "audit", "data": self._compact_audit_context(audit)}

        planning = project_store.load_planning(project_id)
        for workstream in planning.workstreams:
            if workstream.id == node_id:
                return {"id": workstream.id, "type": "workstream", "data": self._compact_workstream_context(workstream)}
            for objective in workstream.objectives:
                if objective.id == node_id:
                    return {
                        "id": objective.id,
                        "type": "objective",
                        "workstream": self._compact_workstream_context(workstream),
                        "data": self._compact_objective_context(objective),
                    }
                for risk in objective.risks:
                    if risk.id == node_id:
                        return {
                            "id": risk.id,
                            "type": "risk",
                            "workstream": self._compact_workstream_context(workstream),
                            "objective": self._compact_objective_context(objective),
                            "data": self._compact_risk_context(risk),
                        }
                    for test in risk.tests:
                        if test.id == node_id:
                            return {
                                "id": test.id,
                                "type": "test",
                                "workstream": self._compact_workstream_context(workstream),
                                "objective": self._compact_objective_context(objective),
                                "risk": self._compact_risk_context(risk),
                                "data": self._compact_test_context(test),
                            }

        fieldwork = project_store.load_fieldwork(project_id)
        for item in fieldwork.items:
            if item.id == node_id:
                return {"id": item.id, "type": "fieldwork_item", "data": self._compact_fieldwork_context(item)}

        findings = project_store.load_findings(project_id)
        for finding in findings.findings:
            if finding.id == node_id:
                return {"id": finding.id, "type": "finding", "data": self._compact_finding_context(finding)}

        return {"id": node_id, "type": "unknown", "title": self._node_title(project_id, node_id)}

    def _compact_audit_context(self, audit: Any) -> dict[str, Any]:
        return {
            "id": audit.id,
            "title": audit.title,
            "description": audit.description,
            "process_area": audit.process_area,
            "initial_concern": audit.initial_concern,
            "extra_context": audit.extra_context,
            "status": audit.status,
        }

    def _compact_workstream_context(self, workstream: Workstream) -> dict[str, Any]:
        return {
            "id": workstream.id,
            "name": workstream.name,
            "description": workstream.description,
            "rationale": workstream.rationale,
            "status": workstream.status,
            "objectives_count": len(workstream.objectives),
        }

    def _compact_objective_context(self, objective: Objective) -> dict[str, Any]:
        return {
            "id": objective.id,
            "title": objective.title,
            "description": objective.description,
            "scope_notes": objective.scope_notes,
            "rationale": objective.rationale,
            "status": objective.status,
            "risks_count": len(objective.risks),
        }

    def _compact_risk_context(self, risk: Risk) -> dict[str, Any]:
        return {
            "id": risk.id,
            "title": risk.title,
            "description": risk.description,
            "why_it_matters": risk.why_it_matters,
            "potential_impact": risk.potential_impact,
            "severity": risk.severity,
            "status": risk.status,
            "tests_count": len(risk.tests),
        }

    def _compact_test_context(self, test: Test) -> dict[str, Any]:
        return {
            "id": test.id,
            "title": test.title,
            "test_type": test.test_type,
            "test_objective": test.test_objective,
            "description": test.description,
            "expected_evidence": test.expected_evidence,
            "sample_considerations": test.sample_considerations,
            "status": test.status,
        }

    def _compact_fieldwork_context(self, item: Any) -> dict[str, Any]:
        return {
            "id": item.id,
            "test_id": item.test_id,
            "source_test_id": item.source_test_id,
            "title": item.title,
            "test_type": item.test_type,
            "description": item.description,
            "expected_evidence": item.expected_evidence,
            "status": item.status,
            "notes": item.notes,
            "evidence_placeholder": item.evidence_placeholder,
            "findings_count": len(item.finding_ids),
        }

    def _compact_finding_context(self, finding: Any) -> dict[str, Any]:
        return {
            "id": finding.id,
            "title": finding.title,
            "issue": finding.issue,
            "criteria": finding.criteria,
            "root_cause": finding.root_cause,
            "impact": finding.impact,
            "recommendation": finding.recommendation,
            "management_action": finding.management_action,
            "severity": finding.severity,
            "linked_fieldwork_item_id": finding.linked_fieldwork_item_id,
            "status": finding.status,
        }

    def _audit_ref(self, audit: Any) -> dict[str, Any]:
        return {"id": audit.id, "type": "audit", "title": audit.title}

    def _workstream_ref(self, workstream: Workstream) -> dict[str, Any]:
        return {"id": workstream.id, "type": "workstream", "title": workstream.name}

    def _objective_ref(self, objective: Objective) -> dict[str, Any]:
        return {"id": objective.id, "type": "objective", "title": objective.title}

    def _risk_ref(self, risk: Risk) -> dict[str, Any]:
        return {"id": risk.id, "type": "risk", "title": risk.title}

    def _test_ref(self, test: Test) -> dict[str, Any]:
        return {"id": test.id, "type": "test", "title": test.title}

    def _node_task_reference(self, project_id: str, node_id: str) -> dict[str, Any]:
        audit = project_store.get_project(project_id)
        if audit.id == node_id:
            return {"item": self._audit_ref(audit), "parent_hierarchy": []}

        planning = project_store.load_planning(project_id)
        for workstream in planning.workstreams:
            if workstream.id == node_id:
                return {"item": self._workstream_ref(workstream), "parent_hierarchy": [self._audit_ref(audit)]}
            for objective in workstream.objectives:
                if objective.id == node_id:
                    return {"item": self._objective_ref(objective), "parent_hierarchy": [self._audit_ref(audit), self._workstream_ref(workstream)]}
                for risk in objective.risks:
                    if risk.id == node_id:
                        return {
                            "item": self._risk_ref(risk),
                            "parent_hierarchy": [self._audit_ref(audit), self._workstream_ref(workstream), self._objective_ref(objective)],
                        }
                    for test in risk.tests:
                        if test.id == node_id:
                            return {
                                "item": self._test_ref(test),
                                "parent_hierarchy": [
                                    self._audit_ref(audit),
                                    self._workstream_ref(workstream),
                                    self._objective_ref(objective),
                                    self._risk_ref(risk),
                                ],
                            }

        graph_item = audit_graph_service.get_item(project_id, node_id)
        if graph_item:
            return {
                "item": {
                    "id": graph_item.get("id"),
                    "type": graph_item.get("type"),
                    "title": graph_item.get("title"),
                },
                "parent_hierarchy": [],
            }
        return {"item": {"id": node_id, "type": "unknown", "title": self._node_title(project_id, node_id)}, "parent_hierarchy": []}

    async def _run_workstream_generator(self, project_id: str, map_state: MapState, agent: AgentState, input_node_ids: list[str], context_pack: ContextPack, capture: dict[str, Any]) -> dict:
        audit = project_store.get_project(project_id)
        if audit.id not in input_node_ids:
            raise ValueError("Connect the Audit card before running this agent.")
        planning = project_store.load_planning(project_id)
        count = int(agent.config.get("workstreams_count", agent.config.get("max_output_items", 5)))
        generated = 0
        occupied = [item.position for item in audit_map_service.build(project_id).nodes if item.type != "phaseNode"]
        map_state.nodeDimensions.update(project_store.load_map_state(project_id).nodeDimensions)
        add_custom_edge(map_state, audit.id, agent.id)
        existing_titles = [workstream.name for workstream in planning.workstreams]
        if settings.demo_mode:
            workstreams = workstream_templates(audit.title, audit.description, count, existing_titles)
        else:
            data = await self._agent_json(
                agent,
                "Generate workstreams for the connected audit card.",
                {
                    "audit": self._audit_ref(audit),
                    "existing_workstream_titles": existing_titles,
                    "count": count,
                },
                {
                    "workstreams": [
                        {
                            "name": "Workstream name",
                            "description": "Detailed workstream description",
                            "rationale": "Why this workstream matters",
                        }
                    ]
                },
                context_pack,
                capture,
            )
            workstreams = [
                Workstream(
                    name=item.get("name", "Workstream"),
                    description=item.get("description", ""),
                    rationale=item.get("rationale", ""),
                    objectives=[],
                )
                for item in data.get("workstreams", [])[: max(1, count)]
            ]
        for index, workstream in enumerate(workstreams):
            planning.workstreams.append(workstream)
            add_custom_edge(map_state, agent.id, workstream.id)
            map_state.nodePositions[workstream.id] = output_position(map_state, agent, "planning", 80, index, occupied)
            generated += 1
        if generated == 0:
            raise ValueError("No workstreams were generated.")
        planning.stage = "workstreams_generated"
        project_store.save_planning(project_id, planning)
        return {"workstreams": generated}

    async def _run_objective_generator(self, project_id: str, map_state: MapState, agent: AgentState, input_node_ids: list[str], context_pack: ContextPack, capture: dict[str, Any]) -> dict:
        planning = project_store.load_planning(project_id)
        count = int(agent.config.get("objectives_per_workstream", 2))
        generated = 0
        occupied = [item.position for item in audit_map_service.build(project_id).nodes if item.type != "phaseNode"]
        map_state.nodeDimensions.update(project_store.load_map_state(project_id).nodeDimensions)
        for workstream in planning.workstreams:
            if workstream.id not in input_node_ids:
                continue
            add_custom_edge(map_state, workstream.id, agent.id)
            existing_titles = [objective.title for objective in workstream.objectives]
            if settings.demo_mode:
                objectives = [objective_templates(index, workstream, existing_titles) for index in range(count)]
            else:
                data = await self._agent_json(
                    agent,
                    "Generate objectives for this connected workstream.",
                    {
                        "workstream": self._workstream_ref(workstream),
                        "existing_objective_titles": existing_titles,
                        "count": count,
                    },
                    {
                        "objectives": [
                            {
                                "title": "Objective title",
                                "description": "Detailed objective description",
                                "scope_notes": "Scope notes",
                                "rationale": "Why this objective matters",
                            }
                        ]
                    },
                    context_pack,
                    capture,
                )
                objectives = [
                    Objective(
                        title=item.get("title", "Audit objective"),
                        description=item.get("description", ""),
                        scope_notes=item.get("scope_notes", ""),
                        rationale=item.get("rationale", ""),
                        risks=[],
                    )
                    for item in data.get("objectives", [])[: max(1, count)]
                ]
            for objective in objectives:
                workstream.objectives.append(objective)
                existing_titles.append(objective.title)
                add_custom_edge(map_state, agent.id, objective.id)
                map_state.nodePositions[objective.id] = output_position(map_state, agent, "planning", 720, generated, occupied)
                generated += 1
        if generated == 0:
            raise ValueError("Connect at least one workstream node before running this agent.")
        planning.stage = "objectives_generated"
        project_store.save_planning(project_id, planning)
        return {"objectives": generated}

    async def _run_risk_generator(self, project_id: str, map_state: MapState, agent: AgentState, input_node_ids: list[str], context_pack: ContextPack, capture: dict[str, Any]) -> dict:
        planning = project_store.load_planning(project_id)
        count = int(agent.config.get("risks_per_objective", 2))
        generated = 0
        occupied = [item.position for item in audit_map_service.build(project_id).nodes if item.type != "phaseNode"]
        map_state.nodeDimensions.update(project_store.load_map_state(project_id).nodeDimensions)
        selected: list[tuple[Workstream, Objective, list[str]]] = []
        for workstream in planning.workstreams:
            for objective in workstream.objectives:
                if objective.id not in input_node_ids:
                    continue
                add_custom_edge(map_state, objective.id, agent.id)
                sibling_titles = [risk.title for sibling in workstream.objectives for risk in sibling.risks]
                existing_titles = [risk.title for risk in objective.risks] + sibling_titles
                selected.append((workstream, objective, existing_titles))

        if not selected:
            raise ValueError("Connect at least one objective node before running this agent.")

        generated_by_objective: dict[str, list[Risk]] = {}
        if settings.demo_mode:
            for _, objective, existing_titles in selected:
                generated_by_objective[objective.id] = [risk_templates(index, objective, existing_titles) for index in range(count)]
        else:
            data = await self._agent_json(
                agent,
                "Generate risks for each connected audit objective.",
                {
                    "risks_per_objective": count,
                    "connected_objectives": [
                        {
                            "parent_workstream": self._workstream_ref(workstream),
                            "objective": self._objective_ref(objective),
                            "existing_risk_titles": existing_titles,
                        }
                        for workstream, objective, existing_titles in selected
                    ],
                    "instructions": [
                        "Return risks grouped by objective_id.",
                        "Generate distinct risks for every connected objective.",
                        "Do not return audit context summaries instead of risks.",
                    ],
                },
                {
                    "risks_by_objective": [
                        {
                            "objective_id": "Objective ID from connected_objectives",
                            "risks": [
                                {
                                    "title": "Risk title",
                                    "description": "Detailed risk description",
                                    "why_it_matters": "Why this risk matters",
                                    "potential_impact": "Potential impact",
                                    "severity": "Low|Medium|High",
                                }
                            ],
                        }
                    ]
                },
                context_pack,
                capture,
            )
            for group in data.get("risks_by_objective", []):
                objective_id = group.get("objective_id")
                if not isinstance(objective_id, str):
                    continue
                generated_by_objective[objective_id] = [
                    Risk(
                        title=item.get("title", "Audit risk"),
                        description=item.get("description", ""),
                        why_it_matters=item.get("why_it_matters", ""),
                        potential_impact=item.get("potential_impact", ""),
                        severity=item.get("severity", "Medium"),
                        tests=[],
                    )
                    for item in group.get("risks", [])[: max(1, count)]
                    if isinstance(item, dict)
                ]

        for _, objective, existing_titles in selected:
            risks = generated_by_objective.get(objective.id, [])
            for risk in risks:
                objective.risks.append(risk)
                existing_titles.append(risk.title)
                add_custom_edge(map_state, agent.id, risk.id)
                map_state.nodePositions[risk.id] = output_position(map_state, agent, "planning", 1360, generated, occupied)
                generated += 1
        if generated == 0:
            raise ValueError("No risks were generated for the connected objective nodes.")
        planning.stage = "risks_generated"
        project_store.save_planning(project_id, planning)
        return {"risks": generated}

    async def _run_test_generator(self, project_id: str, map_state: MapState, agent: AgentState, input_node_ids: list[str], context_pack: ContextPack, capture: dict[str, Any]) -> dict:
        planning = project_store.load_planning(project_id)
        count = int(agent.config.get("tests_per_risk", 2))
        allowed_types = agent.config.get("allowed_test_types", ["Detailed Test"])
        generated = 0
        occupied = [item.position for item in audit_map_service.build(project_id).nodes if item.type != "phaseNode"]
        map_state.nodeDimensions.update(project_store.load_map_state(project_id).nodeDimensions)
        for workstream in planning.workstreams:
            for objective in workstream.objectives:
                for risk in objective.risks:
                    if risk.id not in input_node_ids:
                        continue
                    add_custom_edge(map_state, risk.id, agent.id)
                    sibling_titles = [test.title for sibling_risk in objective.risks for test in sibling_risk.tests]
                    existing_titles = [test.title for test in risk.tests] + sibling_titles
                    if settings.demo_mode:
                        tests = [test_templates(index, risk, allowed_types, agent.id, existing_titles) for index in range(count)]
                    else:
                        data = await self._agent_json(
                            agent,
                            "Generate audit tests for this connected risk.",
                            {
                                "risk": self._risk_ref(risk),
                                "parent_objective": self._objective_ref(objective),
                                "parent_workstream": self._workstream_ref(workstream),
                                "existing_test_titles": existing_titles,
                                "allowed_test_types": allowed_types,
                                "count": count,
                            },
                            {
                                "tests": [
                                    {
                                        "title": "Test title",
                                        "test_type": "Test of Design|Test of Operating Effectiveness|Detailed Test|Analytical Review",
                                        "test_objective": "Test objective",
                                        "description": "Detailed test procedure description",
                                        "expected_evidence": "Expected evidence",
                                        "sample_considerations": "Sample considerations",
                                    }
                                ]
                            },
                            context_pack,
                            capture,
                        )
                        tests = [
                            Test(
                                title=item.get("title", "Audit test"),
                                test_type=item.get("test_type", "Detailed Test"),
                                test_objective=item.get("test_objective", ""),
                                description=item.get("description", ""),
                                expected_evidence=item.get("expected_evidence", ""),
                                sample_considerations=item.get("sample_considerations", ""),
                                generated_by_agent_id=agent.id,
                            )
                            for item in data.get("tests", [])[: max(1, count)]
                        ]
                    for test in tests:
                        risk.tests.append(test)
                        existing_titles.append(test.title)
                        add_custom_edge(map_state, agent.id, test.id)
                        map_state.nodePositions[test.id] = output_position(map_state, agent, "planning", 2000, generated, occupied)
                        generated += 1
        if generated == 0:
            raise ValueError("Connect at least one risk node before running this agent.")
        planning.stage = "tests_generated"
        project_store.save_planning(project_id, planning)
        return {"tests": generated}

    def _get_agent(self, map_state: MapState, agent_id: str) -> AgentState:
        agent = next((item for item in map_state.agents if item.id == agent_id), None)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        if agent.type not in AGENT_DEFINITIONS:
            raise HTTPException(status_code=404, detail="Agent not found")
        return agent


agent_service = AgentService()
