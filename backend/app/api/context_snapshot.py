from fastapi import APIRouter, Request

from app.models import AuditContextSnapshot
from app.runtime import ensure_project_write_allowed
from app.services.audit_context_snapshot_service import audit_context_snapshot_service


router = APIRouter(prefix="/api/projects/{project_id}/context-snapshot", tags=["context-snapshot"])


@router.get("", response_model=AuditContextSnapshot | None)
def get_context_snapshot(project_id: str) -> AuditContextSnapshot | None:
    return audit_context_snapshot_service.get_snapshot(project_id)


@router.post("/rebuild", response_model=AuditContextSnapshot)
def rebuild_context_snapshot(request: Request, project_id: str) -> AuditContextSnapshot:
    ensure_project_write_allowed(request, project_id)
    return audit_context_snapshot_service.rebuild(project_id)
