from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from app.models import AuditProject, FlowEdge
from app.store.project_store import project_store


PLANNING_TYPES = {"audit", "workstream", "objective", "risk", "test"}
FIELDWORK_TYPES = {"fieldwork_item", "document_request", "finding", "interview_role", "interview_question"}
REPORTING_TYPES = {"report"}
DEFAULT_CONTEXT_RELATIONSHIPS = {
    "contains",
    "executed_as",
    "requires_document",
    "clarified_by",
    "results_in",
    "reported_in",
    "summarized_in",
}
SEMANTIC_EDGE_RULES = {
    ("audit", "workstream"): "contains",
    ("workstream", "objective"): "contains",
    ("objective", "risk"): "contains",
    ("risk", "test"): "contains",
    ("test", "fieldwork_item"): "executed_as",
    ("test", "document_request"): "requires_document",
    ("fieldwork_item", "document_request"): "requires_document",
    ("objective", "document_request"): "requires_document",
    ("risk", "document_request"): "requires_document",
    ("objective", "interview_question"): "clarified_by",
    ("risk", "interview_question"): "clarified_by",
    ("test", "interview_question"): "clarified_by",
    ("fieldwork_item", "finding"): "results_in",
    ("finding", "report"): "reported_in",
}


@dataclass(frozen=True)
class AuditGraphItem:
    id: str
    type: str
    title: str
    description: str = ""
    status: str = ""
    phase: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "phase": self.phase,
            "data": self.data,
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class AuditRelationship:
    source_id: str
    target_id: str
    type: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "target_id": self.target_id,
            "type": self.type,
            "metadata": self.metadata,
        }


@dataclass
class AuditGraph:
    project_id: str
    audit: AuditProject
    items: dict[str, AuditGraphItem] = field(default_factory=dict)
    relationships: list[AuditRelationship] = field(default_factory=list)

    def item_dicts(self) -> list[dict[str, Any]]:
        return [item.to_dict() for item in self.items.values()]

    def relationship_dicts(self) -> list[dict[str, Any]]:
        return [relationship.to_dict() for relationship in self.relationships]


class AuditGraphService:
    """Builds and queries a storage-agnostic graph view of an audit project."""

    def build_graph(self, project_id: str) -> AuditGraph:
        audit = project_store.get_project(project_id)
        graph = AuditGraph(project_id=audit.id, audit=audit)
        relationship_keys: set[tuple[str, str, str]] = set()

        def add_item(
            item_id: str,
            item_type: str,
            title: str,
            description: str = "",
            status: str = "",
            data: dict[str, Any] | None = None,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            graph.items[item_id] = AuditGraphItem(
                id=item_id,
                type=item_type,
                title=title,
                description=description,
                status=status,
                phase=self._phase_for_type(item_type),
                data=data or {},
                metadata=metadata or {},
            )

        def add_relationship(source_id: str | None, target_id: str | None, relationship_type: str, metadata: dict[str, Any] | None = None) -> None:
            if not source_id or not target_id or source_id not in graph.items or target_id not in graph.items:
                return
            key = (source_id, target_id, relationship_type)
            if key in relationship_keys:
                return
            relationship_keys.add(key)
            graph.relationships.append(AuditRelationship(source_id=source_id, target_id=target_id, type=relationship_type, metadata=metadata or {}))

        add_item(
            audit.id,
            "audit",
            audit.title,
            audit.description,
            audit.status,
            audit.model_dump(),
            {"process_area": audit.process_area, "initial_concern": audit.initial_concern},
        )

        planning = project_store.load_planning(audit.id)
        for workstream in planning.workstreams:
            add_item(workstream.id, "workstream", workstream.name, workstream.description, workstream.status, workstream.model_dump())
            add_relationship(audit.id, workstream.id, "contains")
            for objective in workstream.objectives:
                add_item(objective.id, "objective", objective.title, objective.description, objective.status, objective.model_dump(), {"workstream_id": workstream.id})
                add_relationship(workstream.id, objective.id, "contains")
                for risk in objective.risks:
                    add_item(risk.id, "risk", risk.title, risk.description, risk.status, risk.model_dump(), {"objective_id": objective.id, "workstream_id": workstream.id})
                    add_relationship(objective.id, risk.id, "contains")
                    for test in risk.tests:
                        add_item(
                            test.id,
                            "test",
                            test.title,
                            test.description,
                            test.status,
                            test.model_dump(),
                            {"risk_id": risk.id, "objective_id": objective.id, "workstream_id": workstream.id},
                        )
                        add_relationship(risk.id, test.id, "contains")

        interviews = project_store.load_interviews(audit.id)
        for role in interviews.roles:
            add_item(role.id, "interview_role", role.role_title, role.expected_information, role.status, role.model_dump())
            for question in role.questions:
                add_item(question.id, "interview_question", question.question_text, role.role_title, question.status, question.model_dump(), {"role_id": role.id})
                add_relationship(role.id, question.id, "contains")
                for mapped_id in [question.mapped_objective_id, question.mapped_risk_id, question.mapped_test_id]:
                    add_relationship(mapped_id, question.id, "clarified_by")

        fieldwork = project_store.load_fieldwork(audit.id)
        for item in fieldwork.items:
            source_test_id = item.source_test_id or item.test_id
            add_item(item.id, "fieldwork_item", item.title, item.description, item.status, item.model_dump(), {"test_id": item.test_id, "source_test_id": source_test_id})
            add_relationship(source_test_id, item.id, "executed_as")

        document_requests = project_store.load_document_requests(audit.id)
        for request in document_requests.requests:
            add_item(request.id, "document_request", request.title, request.description, request.status, request.model_dump(), {"source_node_id": request.source_node_id})
            add_relationship(request.source_node_id, request.id, "requires_document")

        findings = project_store.load_findings(audit.id)
        fieldwork_by_finding_id: dict[str, str] = {}
        for item in fieldwork.items:
            for finding_id in item.finding_ids:
                fieldwork_by_finding_id[finding_id] = item.id
        for finding in findings.findings:
            linked_fieldwork_id = finding.linked_fieldwork_item_id or fieldwork_by_finding_id.get(finding.id)
            add_item(finding.id, "finding", finding.title, finding.issue, finding.status, finding.model_dump(), {"linked_fieldwork_item_id": linked_fieldwork_id})
            add_relationship(linked_fieldwork_id, finding.id, "results_in")

        report = project_store.load_report(audit.id)
        report_meta = report.model_dump()
        add_item("report-main", "report", "Draft Report", report.executive_summary or report.issue_summary, "Ready for Report" if report.draft_markdown or report.executive_summary else "Draft", report_meta)
        add_item("executive-summary", "report", "Executive Summary", report.executive_summary, "Ready for Report" if report.executive_summary else "Draft", report_meta)
        for finding in findings.findings:
            add_relationship(finding.id, "report-main", "reported_in")
            add_relationship(finding.id, "executive-summary", "summarized_in")
        if not findings.findings:
            for item in fieldwork.items[:4]:
                add_relationship(item.id, "report-main", "reported_in")

        map_state = project_store.load_map_state(audit.id)
        for agent in map_state.agents:
            add_item(
                agent.id,
                "agent",
                agent.title,
                agent.prompt,
                agent.status,
                agent.model_dump(),
                {"agent_type": agent.type, "last_run_at": agent.last_run_at},
            )
        for edge in map_state.edges:
            self._add_canvas_relationship(edge, graph, add_relationship)

        return graph

    def get_item(self, project: str | AuditGraph, item_id: str) -> dict[str, Any] | None:
        graph = self._ensure_graph(project)
        item = graph.items.get(item_id)
        return item.to_dict() if item else None

    def get_items_by_type(self, project: str | AuditGraph, item_type: str) -> list[dict[str, Any]]:
        graph = self._ensure_graph(project)
        return [item.to_dict() for item in graph.items.values() if item.type == item_type]

    def get_related_items(
        self,
        project: str | AuditGraph,
        item_id: str,
        depth: int = 1,
        direction: str = "both",
        relationship_types: list[str] | set[str] | None = None,
        exclude_item_types: set[str] | list[str] | None = None,
    ) -> list[dict[str, Any]]:
        graph = self._ensure_graph(project)
        if item_id not in graph.items or depth <= 0:
            return []
        allowed_types = set(relationship_types) if relationship_types is not None else set(DEFAULT_CONTEXT_RELATIONSHIPS)
        excluded_types = {"agent"} if exclude_item_types is None else set(exclude_item_types)
        outgoing, incoming = self._relationship_indexes(graph)
        visited = {item_id}
        queue: deque[tuple[str, int]] = deque([(item_id, 0)])
        related: list[dict[str, Any]] = []

        while queue:
            current_id, current_depth = queue.popleft()
            if current_depth >= depth:
                continue
            edges: list[tuple[str, AuditRelationship, str]] = []
            if direction in {"both", "downstream"}:
                edges.extend((relationship.target_id, relationship, "downstream") for relationship in outgoing.get(current_id, []))
            if direction in {"both", "upstream"}:
                edges.extend((relationship.source_id, relationship, "upstream") for relationship in incoming.get(current_id, []))
            for next_id, relationship, relationship_direction in edges:
                if relationship.type not in allowed_types:
                    continue
                if next_id in visited or next_id not in graph.items:
                    continue
                if graph.items[next_id].type in excluded_types:
                    continue
                visited.add(next_id)
                next_depth = current_depth + 1
                related.append(
                    {
                        "item": graph.items[next_id].to_dict(),
                        "depth": next_depth,
                        "direction": relationship_direction,
                        "relationship": relationship.to_dict(),
                    }
                )
                queue.append((next_id, next_depth))
        return related

    def get_upstream_items(
        self,
        project: str | AuditGraph,
        item_id: str,
        depth: int = 1,
        relationship_types: list[str] | set[str] | None = None,
        exclude_item_types: set[str] | list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return self.get_related_items(project, item_id, depth=depth, direction="upstream", relationship_types=relationship_types, exclude_item_types=exclude_item_types)

    def get_downstream_items(
        self,
        project: str | AuditGraph,
        item_id: str,
        depth: int = 1,
        relationship_types: list[str] | set[str] | None = None,
        exclude_item_types: set[str] | list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return self.get_related_items(project, item_id, depth=depth, direction="downstream", relationship_types=relationship_types, exclude_item_types=exclude_item_types)

    def get_audit_chain(self, project: str | AuditGraph, item_id: str, depth: int = 3) -> dict[str, Any]:
        graph = self._ensure_graph(project)
        return {
            "item": graph.items[item_id].to_dict() if item_id in graph.items else None,
            "related_items": self.get_related_items(graph, item_id, depth=depth, direction="both", exclude_item_types={"agent"}),
        }

    def get_items_by_phase(self, project: str | AuditGraph, phase: str) -> list[dict[str, Any]]:
        graph = self._ensure_graph(project)
        return [item.to_dict() for item in graph.items.values() if item.phase == phase]

    def get_items_by_workstream(self, project: str | AuditGraph, workstream: str | dict[str, Any]) -> list[dict[str, Any]]:
        graph = self._ensure_graph(project)
        workstream_id = workstream.get("id") if isinstance(workstream, dict) else workstream
        if not workstream_id or workstream_id not in graph.items:
            return []
        items = [graph.items[workstream_id].to_dict()]
        related = self.get_related_items(
            graph,
            workstream_id,
            depth=6,
            direction="downstream",
            relationship_types=DEFAULT_CONTEXT_RELATIONSHIPS,
            exclude_item_types={"agent"},
        )
        items.extend(entry["item"] for entry in related)
        return items

    def get_relationship_gaps(self, project: str | AuditGraph) -> list[dict[str, Any]]:
        graph = self._ensure_graph(project)
        outgoing, incoming = self._relationship_indexes(graph)
        gaps: list[dict[str, Any]] = []

        def has_child(item_id: str, child_type: str, relationship_type: str) -> bool:
            return any(relationship.type == relationship_type and graph.items.get(relationship.target_id, None) and graph.items[relationship.target_id].type == child_type for relationship in outgoing.get(item_id, []))

        def has_parent(item_id: str, parent_type: str, relationship_type: str) -> bool:
            return any(relationship.type == relationship_type and graph.items.get(relationship.source_id, None) and graph.items[relationship.source_id].type == parent_type for relationship in incoming.get(item_id, []))

        for item in graph.items.values():
            if item.type == "objective" and not has_child(item.id, "risk", "contains"):
                gaps.append(self._gap(item, "objective_without_risk", "Objective has no linked risks."))
            elif item.type == "risk" and not has_child(item.id, "test", "contains"):
                gaps.append(self._gap(item, "risk_without_test", "Risk has no linked audit tests."))
            if item.type == "risk" and not has_parent(item.id, "objective", "contains"):
                gaps.append(self._gap(item, "risk_without_objective", "Risk is not linked to an objective."))
            if item.type == "test" and not has_parent(item.id, "risk", "contains"):
                gaps.append(self._gap(item, "test_without_risk", "Test is not linked to a risk."))
            if item.type == "test" and not has_child(item.id, "fieldwork_item", "executed_as"):
                gaps.append(self._gap(item, "test_without_fieldwork", "Test has no linked fieldwork item."))
            if item.type == "fieldwork_item" and item.data.get("status") == "Issue Identified" and not has_child(item.id, "finding", "results_in"):
                gaps.append(self._gap(item, "fieldwork_without_finding", "Fieldwork item is marked as an issue but has no finding."))
            if item.type == "document_request" and not item.metadata.get("source_node_id") and not has_parent(item.id, "test", "requires_document"):
                gaps.append(self._gap(item, "document_request_without_test_or_source", "Document request is not linked to a test or source audit item."))
            if item.type == "interview_question" and not any(relationship.type == "clarified_by" for relationship in incoming.get(item.id, [])):
                gaps.append(self._gap(item, "interview_question_without_mapping", "Interview question is not mapped to an objective, risk, or test."))
            if item.type == "finding":
                if not item.metadata.get("linked_fieldwork_item_id") and not has_parent(item.id, "fieldwork_item", "results_in"):
                    gaps.append(self._gap(item, "finding_without_fieldwork", "Finding is not linked to fieldwork."))
                if not has_child(item.id, "report", "reported_in"):
                    gaps.append(self._gap(item, "finding_without_report", "Finding is not linked to a report section."))
                if not item.data.get("recommendation"):
                    gaps.append(self._gap(item, "finding_without_recommendation", "Finding does not include a recommendation."))
                if not item.data.get("impact"):
                    gaps.append(self._gap(item, "finding_without_impact", "Finding does not include impact."))
            if item.type == "report" and item.id == "report-main" and not any(relationship.type == "reported_in" for relationship in incoming.get(item.id, [])):
                gaps.append(self._gap(item, "report_without_findings", "Draft report is not linked to findings."))
        return gaps

    def get_objective_chain(self, project: str | AuditGraph, objective_id: str) -> dict[str, Any]:
        graph = self._ensure_graph(project)
        objective = graph.items.get(objective_id)
        risks = self._children(graph, objective_id, "risk", "contains")
        tests = [test for risk in risks for test in self._children(graph, risk["id"], "test", "contains")]
        fieldwork = [item for test in tests for item in self._children(graph, test["id"], "fieldwork_item", "executed_as")]
        source_ids = {objective_id, *(risk["id"] for risk in risks), *(test["id"] for test in tests), *(item["id"] for item in fieldwork)}
        findings = self._targets_from_sources(graph, {item["id"] for item in fieldwork}, "finding", "results_in")
        interview_questions = self._targets_from_sources(graph, source_ids, "interview_question", "clarified_by")
        return {
            "objective": objective.to_dict() if objective else None,
            "risks": risks,
            "tests": tests,
            "fieldwork_items": fieldwork,
            "document_requests": self._targets_from_sources(graph, source_ids, "document_request", "requires_document"),
            "interview_questions": interview_questions,
            "interview_roles": self._interview_roles_for_questions(graph, interview_questions),
            "findings": findings,
            "report_sections": self._report_sections_for_findings(graph, findings),
        }

    def get_risk_chain(self, project: str | AuditGraph, risk_id: str) -> dict[str, Any]:
        graph = self._ensure_graph(project)
        risk = graph.items.get(risk_id)
        upstream = self.get_upstream_items(graph, risk_id, depth=2)
        tests = self._children(graph, risk_id, "test", "contains")
        fieldwork = [item for test in tests for item in self._children(graph, test["id"], "fieldwork_item", "executed_as")]
        source_ids = {risk_id, *(test["id"] for test in tests), *(item["id"] for item in fieldwork)}
        findings = self._targets_from_sources(graph, {item["id"] for item in fieldwork}, "finding", "results_in")
        interview_questions = self._targets_from_sources(graph, source_ids, "interview_question", "clarified_by")
        return {
            "risk": risk.to_dict() if risk else None,
            "upstream": [entry["item"] for entry in upstream],
            "tests": tests,
            "fieldwork_items": fieldwork,
            "document_requests": self._targets_from_sources(graph, source_ids, "document_request", "requires_document"),
            "interview_questions": interview_questions,
            "interview_roles": self._interview_roles_for_questions(graph, interview_questions),
            "findings": findings,
            "report_sections": self._report_sections_for_findings(graph, findings),
        }

    def get_test_chain(self, project: str | AuditGraph, test_id: str) -> dict[str, Any]:
        graph = self._ensure_graph(project)
        test = graph.items.get(test_id)
        fieldwork = self._children(graph, test_id, "fieldwork_item", "executed_as")
        source_ids = {test_id, *(item["id"] for item in fieldwork)}
        findings = self._targets_from_sources(graph, {item["id"] for item in fieldwork}, "finding", "results_in")
        interview_questions = self._targets_from_sources(graph, {test_id}, "interview_question", "clarified_by")
        return {
            "test": test.to_dict() if test else None,
            "upstream": [entry["item"] for entry in self.get_upstream_items(graph, test_id, depth=3)],
            "fieldwork_items": fieldwork,
            "document_requests": self._targets_from_sources(graph, source_ids, "document_request", "requires_document"),
            "interview_questions": interview_questions,
            "interview_roles": self._interview_roles_for_questions(graph, interview_questions),
            "findings": findings,
            "report_sections": self._report_sections_for_findings(graph, findings),
        }

    def get_traceability_chain(self, project: str | AuditGraph, item_id: str) -> dict[str, Any]:
        graph = self._ensure_graph(project)
        item = graph.items.get(item_id)
        if not item:
            return {"item": None, "related_items": []}
        if item.type == "objective":
            return self.get_objective_chain(graph, item_id)
        if item.type == "risk":
            return self.get_risk_chain(graph, item_id)
        if item.type == "test":
            return self.get_test_chain(graph, item_id)
        return self.get_audit_chain(graph, item_id)

    def get_existing_outputs_for_agent(self, project: str | AuditGraph, agent_type: str, input_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        graph = self._ensure_graph(project)
        outputs: dict[str, list[dict[str, Any]]] = {}
        if agent_type == "report_draft_agent":
            outputs["findings"] = [item.to_dict() for item in graph.items.values() if item.type == "finding"]
            outputs["report_sections"] = [item.to_dict() for item in graph.items.values() if item.type == "report" and any(str(value).strip() for value in item.data.values() if isinstance(value, str))]
            return outputs
        if agent_type == "interview_plan_generator":
            for input_id in input_ids:
                if input_id not in graph.items:
                    continue
                chain = self.get_traceability_chain(graph, input_id)
                questions = chain.get("interview_questions") or self._targets_from_sources(graph, {input_id}, "interview_question", "clarified_by")
                roles = self._interview_roles_for_questions(graph, questions)
                outputs[input_id] = [*roles, *questions]
            return outputs
        if agent_type == "risk_generator":
            for input_id in input_ids:
                item = graph.items.get(input_id)
                if not item:
                    continue
                if item.type == "objective":
                    outputs[input_id] = self._children(graph, input_id, "risk", "contains")
                elif item.type == "workstream":
                    objectives = self._children(graph, input_id, "objective", "contains")
                    risks = [risk for objective in objectives for risk in self._children(graph, objective["id"], "risk", "contains")]
                    outputs[input_id] = [*objectives, *risks]
            return outputs
        if agent_type == "test_generator":
            for input_id in input_ids:
                item = graph.items.get(input_id)
                if not item:
                    continue
                if item.type == "risk":
                    outputs[input_id] = self._children(graph, input_id, "test", "contains")
                elif item.type == "objective":
                    risks = self._children(graph, input_id, "risk", "contains")
                    tests = [test for risk in risks for test in self._children(graph, risk["id"], "test", "contains")]
                    outputs[input_id] = [*risks, *tests]
            return outputs
        if agent_type == "document_request_generator":
            for input_id in input_ids:
                item = graph.items.get(input_id)
                if not item:
                    continue
                source_ids = {input_id}
                if item.type == "fieldwork_item":
                    source_ids.add(str(item.metadata.get("test_id") or item.data.get("test_id") or ""))
                outputs[input_id] = self._targets_from_sources(graph, {source_id for source_id in source_ids if source_id}, "document_request", "requires_document")
            return outputs
        if agent_type == "finding_draft_agent":
            for input_id in input_ids:
                item = graph.items.get(input_id)
                if not item:
                    continue
                if item.type == "fieldwork_item":
                    outputs[input_id] = self._targets_from_sources(graph, {input_id}, "finding", "results_in")
                elif item.type == "test":
                    fieldwork = self._children(graph, input_id, "fieldwork_item", "executed_as")
                    outputs[input_id] = self._targets_from_sources(graph, {entry["id"] for entry in fieldwork}, "finding", "results_in")
            return outputs

        relationship_type, output_type = self._agent_output_rule(agent_type)
        if not relationship_type or not output_type:
            return outputs
        for input_id in input_ids:
            if input_id not in graph.items:
                continue
            outputs[input_id] = self._targets_from_sources(graph, {input_id}, output_type, relationship_type)
        return outputs

    def compact_item(self, item: dict[str, Any] | AuditGraphItem, summary_mode: str = "compact", include_data: bool = False) -> dict[str, Any]:
        item_dict = item.to_dict() if isinstance(item, AuditGraphItem) else item
        data = item_dict.get("data", {})
        compact = {
            "id": item_dict.get("id"),
            "type": item_dict.get("type"),
            "title": item_dict.get("title"),
            "description": self._shorten(item_dict.get("description", ""), 500 if summary_mode == "detailed" else 220),
            "status": item_dict.get("status"),
            "phase": item_dict.get("phase"),
        }
        key_fields = self._key_fields(item_dict.get("type", ""), data)
        if key_fields:
            compact["key_fields"] = key_fields
        if include_data or summary_mode == "detailed":
            compact["data"] = data
        return compact

    def _ensure_graph(self, project: str | AuditGraph) -> AuditGraph:
        return project if isinstance(project, AuditGraph) else self.build_graph(project)

    def _phase_for_type(self, item_type: str) -> str:
        if item_type in PLANNING_TYPES:
            return "planning"
        if item_type in FIELDWORK_TYPES:
            return "fieldwork"
        if item_type in REPORTING_TYPES:
            return "reporting"
        return "workspace"

    def _add_canvas_relationship(self, edge: FlowEdge, graph: AuditGraph, add_relationship) -> None:
        explicit_type = edge.data.get("relationship_type") or edge.data.get("relationshipType")
        inferred = False
        semantic = False
        if edge.source.startswith("agent_") and not edge.target.startswith("agent_"):
            relationship_type = "agent_output"
        elif edge.target.startswith("agent_") and not edge.source.startswith("agent_"):
            relationship_type = "agent_input"
        elif explicit_type:
            relationship_type = str(explicit_type)
            semantic = relationship_type in DEFAULT_CONTEXT_RELATIONSHIPS
        else:
            relationship_type = self._infer_canvas_relationship_type(graph, edge.source, edge.target)
            inferred = relationship_type != "visual_edge"
            semantic = inferred
        add_relationship(edge.source, edge.target, relationship_type, {"source": "canvas", "inferred": inferred, "semantic": semantic})

    def _infer_canvas_relationship_type(self, graph: AuditGraph, source_id: str, target_id: str) -> str:
        source_item = graph.items.get(source_id)
        target_item = graph.items.get(target_id)
        if not source_item or not target_item:
            return "visual_edge"
        if source_item.type == "finding" and target_id == "executive-summary":
            return "summarized_in"
        if source_item.type == "finding" and target_item.type == "report":
            return "reported_in"
        return SEMANTIC_EDGE_RULES.get((source_item.type, target_item.type), "visual_edge")

    def _relationship_indexes(self, graph: AuditGraph) -> tuple[dict[str, list[AuditRelationship]], dict[str, list[AuditRelationship]]]:
        outgoing: dict[str, list[AuditRelationship]] = defaultdict(list)
        incoming: dict[str, list[AuditRelationship]] = defaultdict(list)
        for relationship in graph.relationships:
            outgoing[relationship.source_id].append(relationship)
            incoming[relationship.target_id].append(relationship)
        return outgoing, incoming

    def _children(self, graph: AuditGraph, source_id: str, child_type: str, relationship_type: str) -> list[dict[str, Any]]:
        outgoing, _incoming = self._relationship_indexes(graph)
        children: list[dict[str, Any]] = []
        for relationship in outgoing.get(source_id, []):
            item = graph.items.get(relationship.target_id)
            if relationship.type == relationship_type and item and item.type == child_type:
                children.append(item.to_dict())
        return children

    def _targets_from_sources(self, graph: AuditGraph, source_ids: set[str], target_type: str, relationship_type: str) -> list[dict[str, Any]]:
        outgoing, _incoming = self._relationship_indexes(graph)
        seen: set[str] = set()
        targets: list[dict[str, Any]] = []
        for source_id in source_ids:
            for relationship in outgoing.get(source_id, []):
                target = graph.items.get(relationship.target_id)
                if relationship.type == relationship_type and target and target.type == target_type and target.id not in seen:
                    seen.add(target.id)
                    targets.append(target.to_dict())
        return targets

    def _interview_roles_for_questions(self, graph: AuditGraph, questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        roles: list[dict[str, Any]] = []
        for question in questions:
            role_id = question.get("metadata", {}).get("role_id") or question.get("data", {}).get("role_id")
            role = graph.items.get(role_id) if role_id else None
            if role and role.id not in seen:
                seen.add(role.id)
                roles.append(role.to_dict())
        return roles

    def _report_sections_for_findings(self, graph: AuditGraph, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        finding_ids = {finding["id"] for finding in findings}
        report_sections = self._targets_from_sources(graph, finding_ids, "report", "reported_in")
        summarized_sections = self._targets_from_sources(graph, finding_ids, "report", "summarized_in")
        seen: set[str] = set()
        combined: list[dict[str, Any]] = []
        for section in [*report_sections, *summarized_sections]:
            if section["id"] not in seen:
                seen.add(section["id"])
                combined.append(section)
        return combined

    def _gap(self, item: AuditGraphItem, gap_type: str, message: str) -> dict[str, Any]:
        return {
            "gap_type": gap_type,
            "message": message,
            "item": self.compact_item(item),
        }

    def _agent_output_rule(self, agent_type: str) -> tuple[str | None, str | None]:
        return {
            "workstream_generator": ("contains", "workstream"),
            "objective_generator": ("contains", "objective"),
            "risk_generator": ("contains", "risk"),
            "test_generator": ("contains", "test"),
            "document_request_generator": ("requires_document", "document_request"),
            "finding_draft_agent": ("results_in", "finding"),
        }.get(agent_type, (None, None))

    def _key_fields(self, item_type: str, data: dict[str, Any]) -> dict[str, Any]:
        keys_by_type = {
            "audit": ["process_area", "initial_concern", "extra_context"],
            "workstream": ["rationale"],
            "objective": ["scope_notes", "rationale"],
            "risk": ["severity", "why_it_matters", "potential_impact"],
            "test": ["test_type", "test_objective", "expected_evidence", "sample_considerations"],
            "fieldwork_item": ["test_type", "expected_evidence", "notes", "evidence_placeholder"],
            "document_request": ["requested_from", "expected_document", "rationale", "source_node_id"],
            "finding": ["severity", "criteria", "root_cause", "impact", "recommendation"],
            "interview_role": ["rationale", "expected_information", "notes"],
            "interview_question": ["mapped_objective_id", "mapped_risk_id", "mapped_test_id"],
            "report": ["audit_conclusion", "issue_summary", "key_themes", "management_attention_points"],
            "agent": ["type", "status", "last_run_at"],
        }
        return {key: data.get(key) for key in keys_by_type.get(item_type, []) if data.get(key) not in [None, "", []]}

    def _shorten(self, value: Any, limit: int) -> str:
        text = str(value or "").strip()
        if len(text) <= limit:
            return text
        return f"{text[: max(0, limit - 3)].rstrip()}..."


audit_graph_service = AuditGraphService()
