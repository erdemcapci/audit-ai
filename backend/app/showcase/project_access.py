from __future__ import annotations

from fastapi import HTTPException, Request

from app.models import AuditProject
from app.runtime import anonymous_session_id, current_user, deployment_mode, is_admin_request
from app.store.project_store import project_store


def can_read_project(request: Request, project: AuditProject) -> bool:
    if deployment_mode() == "local":
        return True
    if is_admin_request(request):
        return True
    if project.visibility == "public_sample":
        return True
    user = current_user(request)
    if user and project.visibility == "private" and project.owner_user_id == user.id:
        return True
    session_id = anonymous_session_id(request)
    if project.visibility == "anonymous_temp" and session_id and project.anonymous_session_id == session_id:
        return True
    return False


def can_write_project(request: Request, project: AuditProject) -> bool:
    if deployment_mode() == "local":
        return True
    if is_admin_request(request):
        return True
    if project.visibility == "public_sample":
        return False
    return can_read_project(request, project)


def require_project_read(request: Request, project_id: str) -> AuditProject:
    try:
        project = project_store.get_project(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not can_read_project(request, project):
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def require_project_write(request: Request, project_id: str) -> AuditProject:
    project = require_project_read(request, project_id)
    if not can_write_project(request, project):
        raise HTTPException(status_code=403, detail="This sample audit is read-only. Create a temporary audit to make changes.")
    return project
