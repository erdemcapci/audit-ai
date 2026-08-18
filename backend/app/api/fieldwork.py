from fastapi import APIRouter, Body, Request

from app.models import FieldworkCreateFromPlanningRequest, FieldworkState
from app.runtime import ensure_project_write_allowed
from app.services.fieldwork_service import fieldwork_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/fieldwork", tags=["fieldwork"])


@router.post("/create-from-planning", response_model=FieldworkState)
def create_from_planning(
    request: Request,
    project_id: str,
    payload: FieldworkCreateFromPlanningRequest = Body(default_factory=FieldworkCreateFromPlanningRequest),
) -> FieldworkState:
    ensure_project_write_allowed(request, project_id)
    return fieldwork_service.create_from_planning(project_id, payload)


@router.get("", response_model=FieldworkState)
def get_fieldwork(project_id: str) -> FieldworkState:
    return project_store.load_fieldwork(project_id)


@router.put("", response_model=FieldworkState)
def update_fieldwork(request: Request, project_id: str, fieldwork: FieldworkState) -> FieldworkState:
    ensure_project_write_allowed(request, project_id)
    return project_store.save_fieldwork(project_id, fieldwork)
