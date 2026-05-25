from fastapi import APIRouter, Body, Request

from app.models import FieldworkCreateFromPlanningRequest, FieldworkState
from app.showcase.project_access import require_project_read, require_project_write
from app.services.fieldwork_service import fieldwork_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/fieldwork", tags=["fieldwork"])


@router.post("/create-from-planning", response_model=FieldworkState)
def create_from_planning(
    project_id: str,
    http_request: Request,
    request: FieldworkCreateFromPlanningRequest = Body(default_factory=FieldworkCreateFromPlanningRequest),
) -> FieldworkState:
    require_project_write(http_request, project_id)
    return fieldwork_service.create_from_planning(project_id, request)


@router.get("", response_model=FieldworkState)
def get_fieldwork(project_id: str, request: Request) -> FieldworkState:
    require_project_read(request, project_id)
    return project_store.load_fieldwork(project_id)


@router.put("", response_model=FieldworkState)
def update_fieldwork(project_id: str, fieldwork: FieldworkState, request: Request) -> FieldworkState:
    require_project_write(request, project_id)
    return project_store.save_fieldwork(project_id, fieldwork)
