from fastapi import HTTPException

from app.agents.objectives_agent import ObjectivesAgent
from app.agents.risks_agent import RisksAgent
from app.agents.tests_agent import TestsAgent
from app.llm.base import LLMProviderError
from app.models import PlanningState
from app.store.project_store import project_store


class PlanningService:
    async def generate_objectives(self, project_id: str) -> PlanningState:
        audit = project_store.get_project(project_id)
        try:
            planning = await ObjectivesAgent().run(audit)
        except (LLMProviderError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return project_store.save_planning(project_id, planning)

    async def generate_risks(self, project_id: str) -> PlanningState:
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        try:
            planning = await RisksAgent().run(audit, planning)
        except (LLMProviderError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return project_store.save_planning(project_id, planning)

    async def generate_tests(self, project_id: str) -> PlanningState:
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        try:
            planning = await TestsAgent().run(audit, planning)
        except (LLMProviderError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return project_store.save_planning(project_id, planning)

    def approve(self, project_id: str) -> PlanningState:
        planning = project_store.load_planning(project_id)
        planning.approved = True
        planning.stage = "approved"
        for workstream in planning.workstreams:
            workstream.status = "Confirmed"
            for objective in workstream.objectives:
                objective.status = "Confirmed"
                for risk in objective.risks:
                    risk.status = "Confirmed"
                    for test in risk.tests:
                        test.status = "Confirmed"
        audit = project_store.get_project(project_id)
        audit.status = "fieldwork"
        project_store.save_project(audit)
        return project_store.save_planning(project_id, planning)

    def reopen(self, project_id: str) -> PlanningState:
        planning = project_store.load_planning(project_id)
        planning.approved = False
        has_tests = any(
            risk.tests
            for workstream in planning.workstreams
            for objective in workstream.objectives
            for risk in objective.risks
        )
        has_risks = any(
            objective.risks
            for workstream in planning.workstreams
            for objective in workstream.objectives
        )
        has_objectives = any(workstream.objectives for workstream in planning.workstreams)
        if has_tests:
            planning.stage = "tests_generated"
        elif has_risks:
            planning.stage = "risks_generated"
        elif has_objectives:
            planning.stage = "objectives_generated"
        else:
            planning.stage = "empty"
        audit = project_store.get_project(project_id)
        audit.status = "planning"
        project_store.save_project(audit)
        return project_store.save_planning(project_id, planning)


planning_service = PlanningService()
