from fastapi import APIRouter, Request

from app.models import PlanningReadinessResponse, PlanningState
from app.runtime import ensure_agent_execution_allowed, ensure_project_write_allowed
from app.services.planning_readiness_service import planning_readiness_service
from app.services.planning_service import planning_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/planning", tags=["planning"])


@router.post("/generate-objectives", response_model=PlanningState)
async def generate_objectives(project_id: str, request: Request) -> PlanningState:
    ensure_project_write_allowed(request, project_id)
    ensure_agent_execution_allowed(request)
    return await planning_service.generate_objectives(project_id)


@router.post("/generate-risks", response_model=PlanningState)
async def generate_risks(project_id: str, request: Request) -> PlanningState:
    ensure_project_write_allowed(request, project_id)
    ensure_agent_execution_allowed(request)
    return await planning_service.generate_risks(project_id)


@router.post("/generate-tests", response_model=PlanningState)
async def generate_tests(project_id: str, request: Request) -> PlanningState:
    ensure_project_write_allowed(request, project_id)
    ensure_agent_execution_allowed(request)
    return await planning_service.generate_tests(project_id)


@router.post("/approve", response_model=PlanningState)
def approve(request: Request, project_id: str) -> PlanningState:
    ensure_project_write_allowed(request, project_id)
    return planning_service.approve(project_id)


@router.post("/reopen", response_model=PlanningState)
def reopen(request: Request, project_id: str) -> PlanningState:
    ensure_project_write_allowed(request, project_id)
    return planning_service.reopen(project_id)


@router.get("/readiness", response_model=PlanningReadinessResponse)
def get_readiness(project_id: str) -> PlanningReadinessResponse:
    return planning_readiness_service.get_readiness(project_id)


@router.post("/readiness/ai-review", response_model=PlanningReadinessResponse)
async def run_ai_readiness_review(project_id: str, request: Request) -> PlanningReadinessResponse:
    ensure_project_write_allowed(request, project_id)
    ensure_agent_execution_allowed(request)
    return await planning_readiness_service.run_ai_review(project_id)


@router.get("", response_model=PlanningState)
def get_planning(project_id: str) -> PlanningState:
    return project_store.load_planning(project_id)


@router.put("", response_model=PlanningState)
def update_planning(request: Request, project_id: str, planning: PlanningState) -> PlanningState:
    ensure_project_write_allowed(request, project_id)
    return project_store.save_planning(project_id, planning)
