from fastapi import APIRouter

from app.models import InterviewPlan
from app.services.interview_service import interview_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/interviews", tags=["interviews"])


@router.post("/generate-plan", response_model=InterviewPlan)
async def generate_plan(project_id: str) -> InterviewPlan:
    return await interview_service.generate_plan(project_id)


@router.get("", response_model=InterviewPlan)
def get_interviews(project_id: str) -> InterviewPlan:
    return project_store.load_interviews(project_id)


@router.put("", response_model=InterviewPlan)
def update_interviews(project_id: str, plan: InterviewPlan) -> InterviewPlan:
    return project_store.save_interviews(project_id, plan)
