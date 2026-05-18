import json

from app.agents.demo_data import demo_interviews
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import INTERVIEW_PROMPT, SYSTEM_PROMPT
from app.config import settings
from app.llm.router import get_llm_provider
from app.models import InterviewPlan, InterviewQuestion, InterviewRole, PlanningState


class InterviewAgent:
    async def run(self, planning: PlanningState, max_roles: int = 3, questions_per_role: int = 3) -> InterviewPlan:
        if settings.demo_mode:
            return demo_interviews(planning, max_roles=max_roles, questions_per_role=questions_per_role)
        context = json.dumps(planning.model_dump(), indent=2)
        response = await get_llm_provider().generate(SYSTEM_PROMPT, INTERVIEW_PROMPT.format(planning_context=context))
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        return InterviewPlan(
            roles=[
                InterviewRole(
                    role_title=role.get("role_title", "Interviewee"),
                    rationale=role.get("rationale", ""),
                    expected_information=role.get("expected_information", ""),
                    questions=[InterviewQuestion(**question) for question in role.get("questions", [])[: max(1, questions_per_role)]],
                )
                for role in data.get("roles", [])[: max(1, max_roles)]
            ]
        )
