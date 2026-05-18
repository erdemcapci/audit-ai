from fastapi import APIRouter, Body

from app.models import FieldworkCreateFromPlanningRequest, FieldworkState
from app.services.fieldwork_service import fieldwork_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/fieldwork", tags=["fieldwork"])


@router.post("/create-from-planning", response_model=FieldworkState)
def create_from_planning(
    project_id: str,
    request: FieldworkCreateFromPlanningRequest = Body(default_factory=FieldworkCreateFromPlanningRequest),
) -> FieldworkState:
    return fieldwork_service.create_from_planning(project_id, request)


@router.get("", response_model=FieldworkState)
def get_fieldwork(project_id: str) -> FieldworkState:
    return project_store.load_fieldwork(project_id)


@router.put("", response_model=FieldworkState)
def update_fieldwork(project_id: str, fieldwork: FieldworkState) -> FieldworkState:
    return project_store.save_fieldwork(project_id, fieldwork)
