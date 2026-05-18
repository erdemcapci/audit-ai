from fastapi import APIRouter

from app.models import PlanningState
from app.services.planning_service import planning_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/planning", tags=["planning"])


@router.post("/generate-objectives", response_model=PlanningState)
async def generate_objectives(project_id: str) -> PlanningState:
    return await planning_service.generate_objectives(project_id)


@router.post("/generate-risks", response_model=PlanningState)
async def generate_risks(project_id: str) -> PlanningState:
    return await planning_service.generate_risks(project_id)


@router.post("/generate-tests", response_model=PlanningState)
async def generate_tests(project_id: str) -> PlanningState:
    return await planning_service.generate_tests(project_id)


@router.post("/approve", response_model=PlanningState)
def approve(project_id: str) -> PlanningState:
    return planning_service.approve(project_id)


@router.post("/reopen", response_model=PlanningState)
def reopen(project_id: str) -> PlanningState:
    return planning_service.reopen(project_id)


@router.get("", response_model=PlanningState)
def get_planning(project_id: str) -> PlanningState:
    return project_store.load_planning(project_id)


@router.put("", response_model=PlanningState)
def update_planning(project_id: str, planning: PlanningState) -> PlanningState:
    return project_store.save_planning(project_id, planning)
