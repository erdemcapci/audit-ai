from fastapi import HTTPException

from app.agents.report_agent import ReportAgent
from app.llm.base import LLMProviderError
from app.models import ReportState
from app.store.project_store import project_store


class ReportService:
    async def generate(self, project_id: str) -> ReportState:
        planning = project_store.load_planning(project_id)
        fieldwork = project_store.load_fieldwork(project_id)
        findings = project_store.load_findings(project_id)
        try:
            report = await ReportAgent().run(planning, fieldwork, findings)
        except (LLMProviderError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        audit = project_store.get_project(project_id)
        audit.status = "reporting"
        project_store.save_project(audit)
        return project_store.save_report(project_id, report)


report_service = ReportService()
