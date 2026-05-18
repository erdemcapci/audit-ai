import re
from pathlib import Path

from app.config import settings
from app.models import (
    AuditCreate,
    AuditProject,
    DocumentRequestState,
    FieldworkState,
    FindingsState,
    InterviewPlan,
    MapState,
    PlanningState,
    ReportState,
    utc_now,
)
from app.store.file_store import FileStore


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "audit"


class ProjectStore:
    def __init__(self):
        self.file_store = FileStore(settings.projects_dir)

    def project_dir(self, project_id: str) -> Path:
        for child in settings.projects_dir.iterdir():
            if not child.is_dir():
                continue
            audit_path = child / "audit.json"
            if not audit_path.exists():
                continue
            audit = AuditProject.model_validate(self.file_store.read_json(audit_path, {}))
            if audit.id == project_id or audit.slug == project_id:
                return child
        raise FileNotFoundError(f"Project not found: {project_id}")

    def create_project(self, payload: AuditCreate) -> AuditProject:
        base_slug = slugify(payload.title)
        slug = base_slug
        suffix = 2
        while (settings.projects_dir / slug).exists():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        audit = AuditProject(slug=slug, **payload.model_dump())
        project_dir = settings.projects_dir / slug
        (project_dir / "documents").mkdir(parents=True, exist_ok=True)
        self.file_store.write_json(project_dir / "audit.json", audit.model_dump())
        self.save_planning(audit.id, PlanningState())
        self.save_interviews(audit.id, InterviewPlan())
        self.save_document_requests(audit.id, DocumentRequestState())
        self.save_fieldwork(audit.id, FieldworkState())
        self.save_findings(audit.id, FindingsState())
        self.save_report(audit.id, ReportState())
        self.save_map_state(audit.id, MapState())
        return audit

    def list_projects(self) -> list[AuditProject]:
        projects: list[AuditProject] = []
        for child in sorted(settings.projects_dir.iterdir()):
            audit_path = child / "audit.json"
            if audit_path.exists():
                projects.append(AuditProject.model_validate(self.file_store.read_json(audit_path, {})))
        return sorted(projects, key=lambda project: project.updated_at, reverse=True)

    def get_project(self, project_id: str) -> AuditProject:
        path = self.project_dir(project_id) / "audit.json"
        return AuditProject.model_validate(self.file_store.read_json(path, {}))

    def save_project(self, audit: AuditProject) -> AuditProject:
        audit.updated_at = utc_now()
        self.file_store.write_json(self.project_dir(audit.id) / "audit.json", audit.model_dump())
        return audit

    def delete_project(self, project_id: str) -> None:
        project_dir = self.project_dir(project_id)
        for path in sorted(project_dir.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
        project_dir.rmdir()

    def load_planning(self, project_id: str) -> PlanningState:
        return PlanningState.model_validate(self.file_store.read_json(self.project_dir(project_id) / "planning.json", {}))

    def save_planning(self, project_id: str, planning: PlanningState) -> PlanningState:
        self.file_store.write_json(self.project_dir(project_id) / "planning.json", planning.model_dump())
        return planning

    def load_interviews(self, project_id: str) -> InterviewPlan:
        return InterviewPlan.model_validate(self.file_store.read_json(self.project_dir(project_id) / "interview_plan.json", {}))

    def save_interviews(self, project_id: str, plan: InterviewPlan) -> InterviewPlan:
        self.file_store.write_json(self.project_dir(project_id) / "interview_plan.json", plan.model_dump())
        return plan

    def load_document_requests(self, project_id: str) -> DocumentRequestState:
        return DocumentRequestState.model_validate(self.file_store.read_json(self.project_dir(project_id) / "document_requests.json", {}))

    def save_document_requests(self, project_id: str, requests: DocumentRequestState) -> DocumentRequestState:
        self.file_store.write_json(self.project_dir(project_id) / "document_requests.json", requests.model_dump())
        return requests

    def load_fieldwork(self, project_id: str) -> FieldworkState:
        return FieldworkState.model_validate(self.file_store.read_json(self.project_dir(project_id) / "fieldwork.json", {}))

    def save_fieldwork(self, project_id: str, fieldwork: FieldworkState) -> FieldworkState:
        self.file_store.write_json(self.project_dir(project_id) / "fieldwork.json", fieldwork.model_dump())
        return fieldwork

    def load_findings(self, project_id: str) -> FindingsState:
        return FindingsState.model_validate(self.file_store.read_json(self.project_dir(project_id) / "findings.json", {}))

    def save_findings(self, project_id: str, findings: FindingsState) -> FindingsState:
        self.file_store.write_json(self.project_dir(project_id) / "findings.json", findings.model_dump())
        return findings

    def load_report(self, project_id: str) -> ReportState:
        return ReportState.model_validate(self.file_store.read_json(self.project_dir(project_id) / "report.json", {}))

    def save_report(self, project_id: str, report: ReportState) -> ReportState:
        self.file_store.write_json(self.project_dir(project_id) / "report.json", report.model_dump())
        return report

    def write_report_markdown(self, project_id: str, markdown: str) -> Path:
        path = self.project_dir(project_id) / "report.md"
        self.file_store.write_text(path, markdown)
        return path

    def load_map_state(self, project_id: str) -> MapState:
        return MapState.model_validate(self.file_store.read_json(self.project_dir(project_id) / "map_state.json", {}))

    def save_map_state(self, project_id: str, map_state: MapState) -> MapState:
        path = self.project_dir(project_id) / "map_state.json"
        existing = self.file_store.read_json(path, {}) if path.exists() else {}
        deleted_agent_ids = set(existing.get("deletedAgentIds", [])) | set(map_state.deletedAgentIds)
        if deleted_agent_ids:
            map_state.deletedAgentIds = sorted(deleted_agent_ids)
            map_state.agents = [agent for agent in map_state.agents if agent.id not in deleted_agent_ids]
            map_state.edges = [edge for edge in map_state.edges if edge.source not in deleted_agent_ids and edge.target not in deleted_agent_ids]
            for agent_id in deleted_agent_ids:
                map_state.nodePositions.pop(agent_id, None)
                map_state.nodeDimensions.pop(agent_id, None)
        agent_ids = {agent.id for agent in map_state.agents}
        map_state.edges = [
            edge
            for edge in map_state.edges
            if (not edge.source.startswith("agent_") or edge.source in agent_ids)
            and (not edge.target.startswith("agent_") or edge.target in agent_ids)
        ]
        self.file_store.write_json(path, map_state.model_dump())
        return map_state


project_store = ProjectStore()
