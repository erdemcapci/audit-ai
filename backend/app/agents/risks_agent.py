import json

from app.agents.demo_data import demo_risks
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import RISKS_PROMPT, SYSTEM_PROMPT
from app.config import settings
from app.llm.router import get_llm_provider
from app.models import AuditProject, PlanningState, Risk


class RisksAgent:
    async def run(self, audit: AuditProject, planning: PlanningState) -> PlanningState:
        if settings.demo_mode:
            return demo_risks(planning)
        context = json.dumps({"audit": audit.model_dump(), "planning": planning.model_dump()}, indent=2)
        response = await get_llm_provider().generate(SYSTEM_PROMPT, RISKS_PROMPT.format(planning_context=context))
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        by_objective = {item.get("objective_id"): item.get("risks", []) for item in data.get("risks_by_objective", [])}
        for workstream in planning.workstreams:
            for objective in workstream.objectives:
                objective.risks = [Risk(**risk) for risk in by_objective.get(objective.id, [])]
        planning.stage = "risks_generated"
        return planning
