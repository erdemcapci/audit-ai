from fastapi import APIRouter, HTTPException, Request, Response

from app.config import settings
from app.models import AuditCreate, AuditProject, MessageResponse
from app.runtime import anonymous_session_id, current_user, deployment_mode, ensure_anonymous_session, is_admin_request
from app.showcase.project_access import require_project_read, require_project_write
from app.showcase.rate_limit import enforce_hosted_rate_limit
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=AuditProject)
def create_project(request: Request, response: Response, payload: AuditCreate) -> AuditProject:
    enforce_hosted_rate_limit(request, "project-create", settings.auth_rate_limit_attempts)
    user = current_user(request)
    try:
        if deployment_mode() != "hosted":
            return project_store.create_project(payload)
        if not payload.accepted_data_warning:
            raise HTTPException(status_code=400, detail="Confirm that you will not enter confidential or sensitive data.")
        if user:
            if project_store.count_user_projects(user.id) >= settings.max_user_projects:
                raise HTTPException(status_code=403, detail="Project limit reached for this account.")
            return project_store.create_project(payload, visibility="private", owner_user_id=user.id)
        session_id = ensure_anonymous_session(request, response)
        if project_store.count_anonymous_projects(session_id) >= settings.max_anonymous_projects:
            raise HTTPException(status_code=403, detail="Temporary demo audit limit reached for this browser/session. Sign in to create saved audits.")
        return project_store.create_project(payload, visibility="anonymous_temp", anonymous_session_id=session_id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create project workspace: {exc}") from exc


@router.get("", response_model=list[AuditProject])
def list_projects(request: Request, response: Response) -> list[AuditProject]:
    if deployment_mode() == "hosted":
        user = current_user(request)
        session_id = anonymous_session_id(request) or ensure_anonymous_session(request, response)
        return project_store.list_visible_projects(
            is_hosted=True,
            is_admin=is_admin_request(request),
            user_id=user.id if user else None,
            anonymous_session_id=session_id,
        )
    return project_store.list_projects()


@router.get("/{project_id}", response_model=AuditProject)
def get_project(project_id: str, request: Request) -> AuditProject:
    return require_project_read(request, project_id)


@router.delete("/{project_id}", response_model=MessageResponse)
def delete_project(project_id: str, request: Request) -> MessageResponse:
    project = require_project_read(request, project_id)
    if project.visibility == "public_sample" or project.is_read_only_sample:
        raise HTTPException(status_code=403, detail="The default sample audit cannot be deleted.")
    require_project_write(request, project_id)
    try:
        project_store.delete_project(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return MessageResponse(message="Project deleted")
