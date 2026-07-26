from fastapi import APIRouter

from app.models import AuditContextSnapshot
from app.services.audit_context_snapshot_service import audit_context_snapshot_service


router = APIRouter(prefix="/api/projects/{project_id}/context-snapshot", tags=["context-snapshot"])


@router.get("", response_model=AuditContextSnapshot | None)
def get_context_snapshot(project_id: str) -> AuditContextSnapshot | None:
    return audit_context_snapshot_service.get_snapshot(project_id)


@router.post("/rebuild", response_model=AuditContextSnapshot)
def rebuild_context_snapshot(project_id: str) -> AuditContextSnapshot:
    return audit_context_snapshot_service.rebuild(project_id)
