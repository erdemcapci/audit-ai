from fastapi import HTTPException

from app.agents.interview_agent import InterviewAgent
from app.llm.base import LLMProviderError
from app.models import InterviewPlan
from app.store.project_store import project_store


class InterviewService:
    async def generate_plan(self, project_id: str) -> InterviewPlan:
        planning = project_store.load_planning(project_id)
        try:
            plan = await InterviewAgent().run(planning)
        except (LLMProviderError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return project_store.save_interviews(project_id, plan)


interview_service = InterviewService()
