from app.models import AuditMap, AutoLayoutRequest, FlowEdge, FlowNode, MapState, PhaseLayout, default_phase_layouts
from app.store.project_store import project_store


NODE_WIDTH = 560
NODE_HEIGHT = 140
AGENT_MIN_WIDTH = 560
AGENT_MIN_HEIGHT = 160
AUDIT_NODE_OUTSIDE_GAP = 140
AUDIT_NODE_TOP_OFFSET = 120
PHASE_PADDING = {"top": 100, "right": 120, "bottom": 120, "left": 80}
SECTION_PADDING = {"top": 82, "right": 70, "bottom": 80, "left": 40}
FIELDWORK_SECTION_GAP = 18
FIELDWORK_SECTION_IDS = {
    "issues": "fieldwork-section-issues",
}
FIELDWORK_ARTIFACT_SECTIONS = ["issues"]


def node(
    node_id: str,
    node_type: str,
    x: float,
    y: float,
    title: str,
    description: str = "",
    status: str = "AI Generated",
    meta: dict | None = None,
) -> FlowNode:
    return FlowNode(
        id=node_id,
        type=node_type,
        position={"x": x, "y": y},
        data={"title": title, "description": description, "status": status, **(meta or {})},
    )


def calculate_required_node_size(data: dict, node_type: str, current_width: float | None = None) -> dict[str, float]:
    min_width = AGENT_MIN_WIDTH if node_type == "agentNode" else NODE_WIDTH
    min_height = AGENT_MIN_HEIGHT if node_type == "agentNode" else NODE_HEIGHT
    width = max(float(current_width or min_width), min_width)
    title = str(data.get("title", ""))
    description = str(data.get("description", ""))
    chars_per_line = max(int((width - 36) / 7.2), 24)
    title_lines = max(1, (len(title) + chars_per_line - 1) // chars_per_line)
    description_lines = max(0, (len(description) + chars_per_line - 1) // chars_per_line)
    meta_lines = 1
    if data.get("severity") or data.get("testType") or data.get("itemStatus") or data.get("count") is not None:
        meta_lines += 1
    if node_type == "agentNode":
        meta_lines += 2
    height = 38 + title_lines * 23 + description_lines * 19 + meta_lines * 30 + 24
    return {"width": width, "height": max(float(height), min_height)}


def edge(source: str, target: str, animated: bool = False) -> FlowEdge:
    return FlowEdge(id=f"{source}->{target}", source=source, target=target, animated=animated)


def audit_node_position(planning_layout: PhaseLayout) -> dict[str, float]:
    return {
        "x": planning_layout.x - NODE_WIDTH - AUDIT_NODE_OUTSIDE_GAP,
        "y": planning_layout.y + AUDIT_NODE_TOP_OFFSET,
    }


def move_legacy_audit_position_outside_planning(audit_id: str, planning_layout: PhaseLayout, map_state: MapState) -> None:
    saved = map_state.nodePositions.get(audit_id)
    if not saved:
        return
    x = saved.get("x", 0)
    y = saved.get("y", 0)
    if planning_layout.x <= x <= planning_layout.x + planning_layout.width and planning_layout.y <= y <= planning_layout.y + planning_layout.height:
        map_state.nodePositions[audit_id] = audit_node_position(planning_layout)


def apply_saved_position(node_item: FlowNode, map_state: MapState) -> FlowNode:
    saved = map_state.nodePositions.get(node_item.id)
    if saved:
        node_item.position = saved
    return node_item


def apply_saved_dimensions(node_item: FlowNode, map_state: MapState) -> FlowNode:
    saved = map_state.nodeDimensions.get(node_item.id, {})
    required = calculate_required_node_size(node_item.data, node_item.type, saved.get("width"))
    width = max(float(saved.get("width", required["width"])), required["width"])
    height = max(float(saved.get("height", required["height"])), required["height"])
    node_item.width = width
    node_item.height = height
    node_item.data["width"] = width
    node_item.data["height"] = height
    if saved.get("width") != width or saved.get("height") != height:
        map_state.nodeDimensions[node_item.id] = {"width": width, "height": height}
    return node_item


def board_node(node_item: FlowNode, map_state: MapState) -> FlowNode:
    return apply_saved_dimensions(apply_saved_position(node_item, map_state), map_state)


def phase_node(phase: str, layout: PhaseLayout, title: str, description: str) -> FlowNode:
    return node(
        f"phase-{phase}",
        "phaseNode",
        layout.x,
        layout.y,
        title,
        description,
        "Draft",
        {"width": layout.width, "height": layout.height, "phase": phase},
    )


def fieldwork_section_defaults(fieldwork_layout: PhaseLayout) -> dict[str, PhaseLayout]:
    left = PHASE_PADDING["left"] + NODE_WIDTH + 80
    top = PHASE_PADDING["top"]
    width = max(fieldwork_layout.width - left - 80, 760)
    height = max(fieldwork_layout.height - top - PHASE_PADDING["bottom"], 320)
    issues = PhaseLayout(x=fieldwork_layout.x + left, y=fieldwork_layout.y + top, width=width, height=height)
    return {"issues": issues}


def anchored_fieldwork_section_layouts(fieldwork_layout: PhaseLayout, map_state: MapState) -> dict[str, PhaseLayout]:
    layouts = fieldwork_section_defaults(fieldwork_layout)
    y = fieldwork_layout.y + PHASE_PADDING["top"]
    for section in FIELDWORK_ARTIFACT_SECTIONS:
        layout = layouts[section]
        saved_dimensions = map_state.nodeDimensions.get(FIELDWORK_SECTION_IDS[section], {})
        layout.y = y
        layout.width = max(float(saved_dimensions.get("width", layout.width)), 420)
        layout.height = max(float(saved_dimensions.get("height", layout.height)), 320)
        y = layout.y + layout.height + FIELDWORK_SECTION_GAP
    return layouts


def fieldwork_section_node(section: str, layout: PhaseLayout, title: str, description: str, map_state: MapState, phase: str = "fieldwork") -> FlowNode:
    node_id = FIELDWORK_SECTION_IDS[section]
    section_node = node(
        node_id,
        "fieldworkSectionNode",
        layout.x,
        layout.y,
        title,
        description,
        "Draft",
        {"width": layout.width, "height": layout.height, "phase": phase, "fieldworkSection": section},
    )
    section_node.width = layout.width
    section_node.height = layout.height
    map_state.nodePositions[node_id] = {"x": layout.x, "y": layout.y}
    map_state.nodeDimensions[node_id] = {"width": layout.width, "height": layout.height}
    return section_node


def phase_for_node(node_item: FlowNode, layouts: dict[str, PhaseLayout]) -> str | None:
    if node_item.type == "phaseNode":
        return None
    if node_item.type == "fieldworkSectionNode":
        return "fieldwork"
    if node_item.type == "auditNode":
        return None
    if node_item.type in {"workstreamNode", "objectiveNode", "riskNode", "testNode"}:
        return "planning"
    if node_item.type in {"fieldworkItemNode", "findingNode"}:
        return "fieldwork"
    if node_item.type == "reportNode":
        return "reporting"
    if node_item.type == "agentNode":
        x = node_item.position["x"]
        if x >= layouts["reporting"].x:
            return "reporting"
        if x >= layouts["fieldwork"].x:
            return "fieldwork"
        return "planning"
    return None


def artifact_section_for_node(node_item: FlowNode) -> str | None:
    if node_item.type == "findingNode":
        return "issues"
    if node_item.type == "agentNode":
        agent_type = node_item.data.get("agentType")
        if agent_type == "finding_draft_agent":
            return "issues"
    return None


def expand_artifact_sections(nodes: list[FlowNode], map_state: MapState, sections_to_expand: list[str]) -> bool:
    changed = False
    sections = {node_item.data.get("fieldworkSection"): node_item for node_item in nodes if node_item.type == "fieldworkSectionNode"}
    for section, section_node in sections.items():
        if section not in sections_to_expand:
            continue
        contained = [node_item for node_item in nodes if artifact_section_for_node(node_item) == section]
        if not contained:
            continue
        min_x = min(item.position["x"] for item in contained)
        min_y = min(item.position["y"] for item in contained)
        max_x = max(item.position["x"] + float(item.width or NODE_WIDTH) for item in contained)
        max_y = max(item.position["y"] + float(item.height or NODE_HEIGHT) for item in contained)
        new_x = section_node.position["x"]
        new_y = section_node.position["y"]
        new_width = max(float(section_node.width or 420), max_x - new_x + SECTION_PADDING["right"])
        new_height = max(float(section_node.height or 320), max_y - new_y + SECTION_PADDING["bottom"])
        if new_x != section_node.position["x"] or new_y != section_node.position["y"] or new_width != section_node.width or new_height != section_node.height:
            section_node.position = {"x": new_x, "y": new_y}
            section_node.width = new_width
            section_node.height = new_height
            section_node.data["width"] = new_width
            section_node.data["height"] = new_height
            map_state.nodePositions[section_node.id] = section_node.position
            map_state.nodeDimensions[section_node.id] = {"width": new_width, "height": new_height}
            changed = True
    return changed


def restack_artifact_sections(nodes: list[FlowNode], map_state: MapState, base_layout: PhaseLayout, section_order: list[str], start_y: float | None = None) -> bool:
    changed = False
    sections = {
        node_item.data.get("fieldworkSection"): node_item
        for node_item in nodes
        if node_item.type == "fieldworkSectionNode"
    }
    y = start_y if start_y is not None else base_layout.y + PHASE_PADDING["top"]
    for section in section_order:
        section_node = sections.get(section)
        if not section_node:
            continue
        current_y = section_node.position["y"]
        delta_y = y - current_y
        if delta_y:
            section_node.position["y"] = y
            section_node.data["height"] = section_node.height
            map_state.nodePositions[section_node.id] = section_node.position
            for node_item in nodes:
                if artifact_section_for_node(node_item) == section:
                    node_item.position["y"] += delta_y
                    map_state.nodePositions[node_item.id] = node_item.position
            changed = True
        y = section_node.position["y"] + float(section_node.height or 320) + FIELDWORK_SECTION_GAP
    return changed


def expand_phase_to_fit_nodes(phase: str, nodes: list[FlowNode], layout: PhaseLayout, layouts: dict[str, PhaseLayout]) -> bool:
    contained = [item for item in nodes if phase_for_node(item, layouts) == phase]
    if not contained:
        return False
    max_x = max(item.position["x"] + float(item.width or NODE_WIDTH) for item in contained)
    max_y = max(item.position["y"] + float(item.height or NODE_HEIGHT) for item in contained)
    needed_width = max_x - layout.x + PHASE_PADDING["right"]
    needed_height = max_y - layout.y + PHASE_PADDING["bottom"]
    changed = False
    if needed_width > layout.width:
        layout.width = needed_width
        changed = True
    if needed_height > layout.height:
        layout.height = needed_height
        changed = True
    return changed


def shift_phase_nodes(phase: str, delta_x: float, nodes: list[FlowNode], map_state: MapState, layouts: dict[str, PhaseLayout]) -> None:
    if delta_x == 0:
        return
    for item in nodes:
        if phase_for_node(item, layouts) == phase:
            item.position["x"] += delta_x
            map_state.nodePositions[item.id] = item.position


def ensure_phase_spacing(nodes: list[FlowNode], map_state: MapState) -> bool:
    layouts = map_state.phaseLayouts
    changed = False
    gap = 0
    planning = layouts["planning"]
    fieldwork = layouts["fieldwork"]
    reporting = layouts["reporting"]

    needed_fieldwork_x = planning.x + planning.width + gap
    if fieldwork.x < needed_fieldwork_x:
        delta = needed_fieldwork_x - fieldwork.x
        fieldwork.x = needed_fieldwork_x
        shift_phase_nodes("fieldwork", delta, nodes, map_state, layouts)
        changed = True

    needed_reporting_x = fieldwork.x + fieldwork.width + gap
    if reporting.x < needed_reporting_x:
        delta = needed_reporting_x - reporting.x
        reporting.x = needed_reporting_x
        shift_phase_nodes("reporting", delta, nodes, map_state, layouts)
        changed = True

    return changed


def agent_auto_layout_position(agent_type: str, layouts: dict[str, PhaseLayout], columns: dict[str, float], index_by_column: dict[str, int], vertical_gap: float) -> tuple[str, float, float]:
    planning_layout = layouts["planning"]
    fieldwork_layout = layouts["fieldwork"]
    reporting_layout = layouts["reporting"]

    phase = "planning"
    x = columns["audit"]
    if agent_type == "workstream_generator":
        x = audit_node_position(planning_layout)["x"]
    if agent_type == "objective_generator":
        x = columns["workstream"]
    elif agent_type == "risk_generator":
        x = columns["objective"]
    elif agent_type == "test_generator":
        x = columns["risk"]
    elif agent_type == "finding_draft_agent":
        phase = "fieldwork"
        x = columns["issues"]
    elif agent_type == "report_draft_agent":
        phase = "reporting"
        x = columns["report"]

    layout = {"planning": planning_layout, "fieldwork": fieldwork_layout, "reporting": reporting_layout}[phase]
    column_key = f"{phase}:{int(x)}"
    same_column_index = index_by_column.get(column_key, 0)
    index_by_column[column_key] = same_column_index + 1
    stack_gap = max(vertical_gap, 24)
    y = layout.y - AGENT_MIN_HEIGHT - 36 - same_column_index * (AGENT_MIN_HEIGHT + stack_gap)
    return phase, x, y


class AuditMapService:
    def auto_layout(self, project_id: str, config: AutoLayoutRequest) -> AuditMap:
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        fieldwork = project_store.load_fieldwork(project_id)
        findings = project_store.load_findings(project_id)
        report = project_store.load_report(project_id)
        map_state = project_store.load_map_state(project_id)

        min_width = max(config.card_width, NODE_WIDTH)
        horizontal_gap = max(config.horizontal_gap, min_width + 40)
        vertical_gap = max(config.vertical_gap, 0)
        phase_gap = max(config.phase_gap, 0)
        left = PHASE_PADDING["left"]
        top = PHASE_PADDING["top"] + 40

        layouts = default_phase_layouts()
        planning_layout = layouts["planning"]
        fieldwork_layout = layouts["fieldwork"]
        reporting_layout = layouts["reporting"]

        map_state.nodePositions = {}
        map_state.nodeDimensions = {}

        def place(node_id: str, node_type: str, x: float, y: float, title: str, description: str = "", meta: dict | None = None) -> dict[str, float]:
            data = {"title": title, "description": description, **(meta or {})}
            size = calculate_required_node_size(data, node_type, min_width)
            map_state.nodePositions[node_id] = {"x": x, "y": y}
            map_state.nodeDimensions[node_id] = {"width": min_width, "height": size["height"]}
            return map_state.nodeDimensions[node_id]

        audit_position = audit_node_position(planning_layout)
        place(audit.id, "auditNode", audit_position["x"], audit_position["y"], audit.title, audit.description)
        cursor_y = planning_layout.y + top
        max_planning_bottom = cursor_y

        workstream_x = planning_layout.x + left
        objective_x = workstream_x + horizontal_gap
        risk_x = objective_x + horizontal_gap
        test_x = risk_x + horizontal_gap

        for workstream in planning.workstreams:
            group_y = cursor_y
            ws_size = place(workstream.id, "workstreamNode", workstream_x, group_y, workstream.name, workstream.description, {"count": len(workstream.objectives)})
            objective_cursor = group_y
            objective_bottom = group_y + ws_size["height"]
            for objective in workstream.objectives:
                objective_y = objective_cursor
                objective_size = place(objective.id, "objectiveNode", objective_x, objective_y, objective.title, objective.description, {"count": len(objective.risks)})
                risk_cursor = objective_y
                risk_bottom = objective_y + objective_size["height"]
                for risk in objective.risks:
                    risk_y = risk_cursor
                    risk_size = place(risk.id, "riskNode", risk_x, risk_y, risk.title, risk.description, {"severity": risk.severity, "count": len(risk.tests)})
                    test_cursor = risk_y
                    test_bottom = risk_y + risk_size["height"]
                    for test in risk.tests:
                        test_size = place(test.id, "testNode", test_x, test_cursor, test.title, test.description, {"testType": test.test_type})
                        test_cursor += test_size["height"] + vertical_gap
                        test_bottom = max(test_bottom, test_cursor - vertical_gap)
                    risk_block_bottom = max(risk_y + risk_size["height"], test_bottom)
                    risk_cursor = risk_block_bottom + vertical_gap
                    risk_bottom = max(risk_bottom, risk_block_bottom)
                objective_block_bottom = max(objective_y + objective_size["height"], risk_bottom)
                objective_cursor = objective_block_bottom + vertical_gap
                objective_bottom = max(objective_bottom, objective_block_bottom)
            group_bottom = max(group_y + ws_size["height"], objective_bottom)
            cursor_y = group_bottom + vertical_gap
            max_planning_bottom = max(max_planning_bottom, group_bottom)

        planning_layout.width = max(test_x - planning_layout.x + min_width + PHASE_PADDING["right"], planning_layout.width)
        planning_layout.height = max(max_planning_bottom - planning_layout.y + PHASE_PADDING["bottom"], planning_layout.height)

        fieldwork_layout.x = planning_layout.x + planning_layout.width + phase_gap
        fieldwork_sections = anchored_fieldwork_section_layouts(fieldwork_layout, map_state)
        issues_layout = fieldwork_sections["issues"]
        report_x_base = fieldwork_layout.x + left

        field_cursor = fieldwork_layout.y + top
        max_fieldwork_bottom = field_cursor
        for item in fieldwork.items:
            item_size = place(item.id, "fieldworkItemNode", report_x_base, field_cursor, item.title, item.description, {"testType": item.test_type, "itemStatus": item.status})
            field_cursor += item_size["height"] + vertical_gap
            max_fieldwork_bottom = max(max_fieldwork_bottom, field_cursor - vertical_gap)

        finding_x = issues_layout.x + SECTION_PADDING["left"]

        finding_cursor = issues_layout.y + SECTION_PADDING["top"]
        max_issues_bottom = finding_cursor
        for finding in findings.findings:
            finding_size = place(finding.id, "findingNode", finding_x, finding_cursor, finding.title, finding.issue, {"severity": finding.severity})
            finding_cursor += finding_size["height"] + vertical_gap
            max_issues_bottom = max(max_issues_bottom, finding_cursor - vertical_gap)

        issues_layout.height = max(
            issues_layout.height,
            max_issues_bottom - issues_layout.y + SECTION_PADDING["bottom"],
        )
        max_fieldwork_bottom = max(
            max_fieldwork_bottom,
            max_issues_bottom,
            max(section.y + section.height for section in fieldwork_sections.values()),
        )

        fieldwork_layout.width = max(
            max(section.x + section.width for section in fieldwork_sections.values()) - fieldwork_layout.x + PHASE_PADDING["right"],
            fieldwork_layout.width,
        )
        fieldwork_layout.height = max(
            max(max_fieldwork_bottom, max(section.y + section.height for section in fieldwork_sections.values())) - fieldwork_layout.y + PHASE_PADDING["bottom"],
            fieldwork_layout.height,
        )

        reporting_layout.x = fieldwork_layout.x + fieldwork_layout.width + phase_gap
        report_x = reporting_layout.x + left
        report_cursor = reporting_layout.y + top
        report_size = place("report-main", "reportNode", report_x, report_cursor, "Draft Report", report.executive_summary or "Generate reporting content from planning, fieldwork, and findings.")
        report_cursor += report_size["height"] + vertical_gap
        summary_size = place("executive-summary", "reportNode", report_x, report_cursor, "Executive Summary", report.executive_summary)
        max_reporting_bottom = report_cursor + summary_size["height"]
        reporting_layout.width = max(report_x - reporting_layout.x + min_width + PHASE_PADDING["right"], reporting_layout.width)
        reporting_layout.height = max(max_reporting_bottom - reporting_layout.y + PHASE_PADDING["bottom"], reporting_layout.height)

        agent_columns = {
            "audit": audit_position["x"],
            "workstream": workstream_x,
            "objective": objective_x,
            "risk": risk_x,
            "test": test_x,
            "fieldwork_item": report_x_base,
            "issues": finding_x,
            "finding": finding_x,
            "report": report_x,
        }
        agent_column_counts: dict[str, int] = {}
        for agent in map_state.agents:
            _agent_phase, agent_x, agent_y = agent_auto_layout_position(agent.type, layouts, agent_columns, agent_column_counts, vertical_gap)
            place(agent.id, "agentNode", agent_x, agent_y, agent.title, agent.prompt, {"agentType": agent.type})
            agent.position = map_state.nodePositions[agent.id]

        for section, layout in fieldwork_sections.items():
            section_id = FIELDWORK_SECTION_IDS[section]
            map_state.nodePositions[section_id] = {"x": layout.x, "y": layout.y}
            map_state.nodeDimensions[section_id] = {"width": layout.width, "height": layout.height}

        map_state.phaseLayouts = layouts
        project_store.save_map_state(project_id, map_state)
        return self.build(project_id)

    def build(self, project_id: str) -> AuditMap:
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        fieldwork = project_store.load_fieldwork(project_id)
        findings = project_store.load_findings(project_id)
        report = project_store.load_report(project_id)
        map_state = project_store.load_map_state(project_id)
        layouts = map_state.phaseLayouts
        planning_layout = layouts["planning"]
        fieldwork_layout = layouts["fieldwork"]
        reporting_layout = layouts["reporting"]
        fieldwork_sections = anchored_fieldwork_section_layouts(fieldwork_layout, map_state)
        issues_section = fieldwork_sections["issues"]
        move_legacy_audit_position_outside_planning(audit.id, planning_layout, map_state)

        nodes: list[FlowNode] = [
            phase_node("planning", planning_layout, "PLANNING", "Workstreams, objectives, risks, tests"),
            phase_node("fieldwork", fieldwork_layout, "FIELDWORK", "Fieldwork items and issues"),
            phase_node("reporting", reporting_layout, "REPORTING", "Executive summary and report"),
            fieldwork_section_node("issues", issues_section, "Issues", "Findings, recommendations, and actions", map_state),
            board_node(
                node(
                    audit.id,
                    "auditNode",
                    audit_node_position(planning_layout)["x"],
                    audit_node_position(planning_layout)["y"],
                    audit.title,
                    audit.description,
                    "Draft",
                    {"projectId": audit.id},
                ),
                map_state,
            ),
        ]
        edges: list[FlowEdge] = []
        y = planning_layout.y + 260
        for workstream in planning.workstreams:
            nodes.append(board_node(node(workstream.id, "workstreamNode", planning_layout.x + 80, y, workstream.name, workstream.description, workstream.status, {"rationale": workstream.rationale, "count": len(workstream.objectives)}), map_state))
            edges.append(edge(audit.id, workstream.id, planning.stage == "objectives_generated"))
            local_y = y
            for objective in workstream.objectives:
                nodes.append(board_node(node(objective.id, "objectiveNode", planning_layout.x + 720, local_y, objective.title, objective.description, objective.status, {"count": len(objective.risks), "rationale": objective.rationale, "scope_notes": objective.scope_notes}), map_state))
                edges.append(edge(workstream.id, objective.id))
                risk_y = local_y
                for risk in objective.risks:
                    nodes.append(board_node(node(risk.id, "riskNode", planning_layout.x + 1360, risk_y, risk.title, risk.description, risk.status, {"severity": risk.severity, "why_it_matters": risk.why_it_matters, "potential_impact": risk.potential_impact, "count": len(risk.tests)}), map_state))
                    edges.append(edge(objective.id, risk.id, planning.stage == "risks_generated"))
                    test_y = risk_y
                    for test in risk.tests:
                        nodes.append(board_node(node(test.id, "testNode", planning_layout.x + 2000, test_y, test.title, test.description, test.status, {"testType": test.test_type, "test_type": test.test_type, "test_objective": test.test_objective, "expected_evidence": test.expected_evidence, "sample_considerations": test.sample_considerations}), map_state))
                        edges.append(edge(risk.id, test.id, planning.stage == "tests_generated" and not test.generated_by_agent_id))
                        test_y += 180
                    risk_y = max(risk_y + 180, test_y)
                local_y = max(local_y + 180, risk_y)
            y = max(y + 260, local_y + 80)

        fieldwork_y = fieldwork_layout.y + PHASE_PADDING["top"] + 40
        for item in fieldwork.items:
            status = "Issue Found" if item.status == "Issue Identified" else ("In Progress" if item.status != "Not Started" else "Draft")
            nodes.append(board_node(node(item.id, "fieldworkItemNode", fieldwork_layout.x + PHASE_PADDING["left"], fieldwork_y, item.title, item.description, status, {"testType": item.test_type, "test_type": item.test_type, "itemStatus": item.status, "expected_evidence": item.expected_evidence, "notes": item.notes, "evidence_placeholder": item.evidence_placeholder, "source_test_id": item.source_test_id or item.test_id}), map_state))
            if item.test_id:
                edges.append(edge(item.test_id, item.id, planning.approved))
            fieldwork_y += 180

        finding_y = issues_section.y + SECTION_PADDING["top"]
        for finding in findings.findings:
            nodes.append(board_node(node(finding.id, "findingNode", issues_section.x + SECTION_PADDING["left"], finding_y, finding.title, finding.issue, finding.status, {"severity": finding.severity, "issue": finding.issue, "criteria": finding.criteria, "root_cause": finding.root_cause, "impact": finding.impact, "recommendation": finding.recommendation, "management_action": finding.management_action}), map_state))
            if finding.linked_fieldwork_item_id:
                edges.append(edge(finding.linked_fieldwork_item_id, finding.id))
            finding_y += 190

        report_id = "report-main"
        report_meta = {"executive_summary": report.executive_summary, "audit_conclusion": report.audit_conclusion, "issue_summary": report.issue_summary, "ai_improved_version": report.ai_improved_version, "draft_markdown": report.draft_markdown}
        nodes.append(board_node(node(report_id, "reportNode", reporting_layout.x + 120, reporting_layout.y + 140, "Draft Report", "Open to view and edit the markdown report.", "Ready for Report" if report.draft_markdown or report.executive_summary else "Draft", report_meta), map_state))
        nodes.append(board_node(node("executive-summary", "reportNode", reporting_layout.x + 120, reporting_layout.y + 360, "Executive Summary", "Open to view and edit the executive summary.", "Ready for Report" if report.executive_summary else "Draft", report_meta), map_state))
        for finding in findings.findings:
            edges.append(edge(finding.id, report_id))
        if not findings.findings:
            for item in fieldwork.items[:4]:
                edges.append(edge(item.id, report_id))

        for agent in map_state.agents:
            agent_position = map_state.nodePositions.get(agent.id, agent.position)
            if agent.type not in {"workstream_generator", "objective_generator", "risk_generator", "test_generator", "finding_draft_agent", "report_draft_agent"}:
                continue
            nodes.append(
                board_node(
                    node(
                        agent.id,
                        "agentNode",
                        agent_position.get("x", planning_layout.x + 360),
                        agent_position.get("y", planning_layout.y + 220),
                        agent.title,
                        agent.prompt,
                        agent.status.title(),
                        {
                            "agentType": agent.type,
                            "projectId": audit.id,
                            "config": agent.config,
                            "lastRunAt": agent.last_run_at,
                            "lastError": agent.last_error,
                            "lastOutput": agent.last_output,
                            "inputCount": len([custom_edge for custom_edge in map_state.edges if custom_edge.target == agent.id]),
                        },
                    ),
                    map_state,
                )
            )

        existing_edge_ids = {item.id for item in edges}
        for custom_edge in map_state.edges:
            if custom_edge.id not in existing_edge_ids:
                edges.append(custom_edge)

        original_dimensions = {key: dict(value) for key, value in map_state.nodeDimensions.items()}
        changed = False
        changed = expand_artifact_sections(nodes, map_state, FIELDWORK_ARTIFACT_SECTIONS) or changed
        changed = restack_artifact_sections(nodes, map_state, fieldwork_layout, FIELDWORK_ARTIFACT_SECTIONS) or changed
        for phase_key, layout in layouts.items():
            changed = expand_phase_to_fit_nodes(phase_key, nodes, layout, layouts) or changed
        changed = ensure_phase_spacing(nodes, map_state) or changed
        if changed:
            expand_artifact_sections(nodes, map_state, FIELDWORK_ARTIFACT_SECTIONS)
            restack_artifact_sections(nodes, map_state, fieldwork_layout, FIELDWORK_ARTIFACT_SECTIONS)
            for phase_key, layout in layouts.items():
                expand_phase_to_fit_nodes(phase_key, nodes, layout, layouts)
        dimensions_changed = original_dimensions != map_state.nodeDimensions
        if changed or dimensions_changed:
            project_store.save_map_state(project_id, map_state)
        for phase_id, layout in [("phase-planning", planning_layout), ("phase-fieldwork", fieldwork_layout), ("phase-reporting", reporting_layout)]:
            for phase in nodes:
                if phase.id == phase_id:
                    phase.position["x"] = layout.x
                    phase.position["y"] = layout.y
                    phase.data["width"] = layout.width
                    phase.data["height"] = layout.height
        for section in nodes:
            if section.type == "fieldworkSectionNode":
                saved_position = map_state.nodePositions.get(section.id)
                saved_dimensions = map_state.nodeDimensions.get(section.id)
                if saved_position:
                    section.position = saved_position
                if saved_dimensions:
                    section.width = saved_dimensions.get("width", section.width)
                    section.height = saved_dimensions.get("height", section.height)
                    section.data["width"] = section.width
                    section.data["height"] = section.height
        return AuditMap(nodes=nodes, edges=edges)


audit_map_service = AuditMapService()
