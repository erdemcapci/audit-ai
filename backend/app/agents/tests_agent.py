import json

from app.agents.demo_data import demo_tests
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import SYSTEM_PROMPT, TESTS_PROMPT
from app.config import settings
from app.llm.router import get_llm_provider
from app.models import AuditProject, PlanningState, Test


class TestsAgent:
    async def run(self, audit: AuditProject, planning: PlanningState) -> PlanningState:
        if settings.demo_mode:
            return demo_tests(planning)
        context = json.dumps({"audit": audit.model_dump(), "planning": planning.model_dump()}, indent=2)
        response = await get_llm_provider().generate(SYSTEM_PROMPT, TESTS_PROMPT.format(planning_context=context))
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        by_risk = {item.get("risk_id"): item.get("tests", []) for item in data.get("tests_by_risk", [])}
        for workstream in planning.workstreams:
            for objective in workstream.objectives:
                for risk in objective.risks:
                    risk.tests = [Test(**test) for test in by_risk.get(risk.id, [])]
        planning.stage = "tests_generated"
        return planning
