import json

from app.agents.demo_data import demo_risks
from app.agents.context_utils import compact_audit, compact_planning
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import RISKS_PROMPT, SYSTEM_PROMPT
from app.demo_generation import current_ai_model, demo_generation_enabled
from app.llm.router import get_llm_provider
from app.models import AuditProject, PlanningState, Risk


class RisksAgent:
    async def run(self, audit: AuditProject, planning: PlanningState) -> PlanningState:
        if demo_generation_enabled():
            return demo_risks(planning)
        context = json.dumps({"audit": compact_audit(audit), "planning": compact_planning(planning)}, indent=2)
        response = await get_llm_provider().generate(SYSTEM_PROMPT, RISKS_PROMPT.format(planning_context=context), model=current_ai_model())
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        by_objective = {item.get("objective_id"): item.get("risks", []) for item in data.get("risks_by_objective", [])}
        for workstream in planning.workstreams:
            for objective in workstream.objectives:
                objective.risks = [Risk(**risk) for risk in by_objective.get(objective.id, [])]
        planning.stage = "risks_generated"
        return planning
