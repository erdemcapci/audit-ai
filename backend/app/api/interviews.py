from fastapi import APIRouter, Request

from app.models import InterviewPlan
from app.showcase.project_access import require_project_read, require_project_write
from app.runtime import ensure_agent_execution_allowed, record_successful_ai_run
from app.services.interview_service import interview_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/interviews", tags=["interviews"])


@router.post("/generate-plan", response_model=InterviewPlan)
async def generate_plan(project_id: str, request: Request) -> InterviewPlan:
    require_project_write(request, project_id)
    ensure_agent_execution_allowed(request)
    plan = await interview_service.generate_plan(project_id)
    record_successful_ai_run(request)
    return plan


@router.get("", response_model=InterviewPlan)
def get_interviews(project_id: str, request: Request) -> InterviewPlan:
    require_project_read(request, project_id)
    return project_store.load_interviews(project_id)


@router.put("", response_model=InterviewPlan)
def update_interviews(project_id: str, plan: InterviewPlan, request: Request) -> InterviewPlan:
    require_project_write(request, project_id)
    return project_store.save_interviews(project_id, plan)
