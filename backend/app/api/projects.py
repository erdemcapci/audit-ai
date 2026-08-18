from fastapi import APIRouter, HTTPException, Request

from app.models import AuditCreate, AuditProject, MessageResponse
from app.runtime import ensure_project_write_allowed
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=AuditProject)
def create_project(payload: AuditCreate) -> AuditProject:
    try:
        return project_store.create_project(payload)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create project workspace: {exc}") from exc


@router.get("", response_model=list[AuditProject])
def list_projects() -> list[AuditProject]:
    return project_store.list_projects()


@router.get("/{project_id}", response_model=AuditProject)
def get_project(project_id: str) -> AuditProject:
    try:
        return project_store.get_project(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{project_id}", response_model=MessageResponse)
def delete_project(request: Request, project_id: str) -> MessageResponse:
    ensure_project_write_allowed(request, project_id)
    try:
        project_store.delete_project(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return MessageResponse(message="Project deleted")
