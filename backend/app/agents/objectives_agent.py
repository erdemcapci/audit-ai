import json

from app.agents.demo_data import demo_objectives
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import OBJECTIVES_PROMPT, SYSTEM_PROMPT
from app.config import settings
from app.llm.router import get_llm_provider
from app.models import AuditProject, Objective, PlanningState, Workstream


class ObjectivesAgent:
    async def run(self, audit: AuditProject) -> PlanningState:
        if settings.demo_mode:
            return demo_objectives(audit.title, audit.description)
        context = json.dumps(audit.model_dump(), indent=2)
        response = await get_llm_provider().generate(SYSTEM_PROMPT, OBJECTIVES_PROMPT.format(audit_context=context))
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        workstreams = [
            Workstream(
                name=item.get("name", "Workstream"),
                description=item.get("description", ""),
                rationale=item.get("rationale", ""),
                objectives=[Objective(**objective) for objective in item.get("objectives", [])],
            )
            for item in data.get("workstreams", [])
        ]
        return PlanningState(
            stage="objectives_generated",
            workstreams=workstreams,
            assumptions=data.get("assumptions", []),
            open_questions=data.get("open_questions", []),
        )
