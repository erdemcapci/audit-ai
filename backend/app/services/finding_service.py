from fastapi import HTTPException

from app.agents.finding_agent import FindingAgent
from app.llm.base import LLMProviderError
from app.models import Finding, FindingDraftRequest
from app.store.project_store import project_store


class FindingService:
    async def refine(self, project_id: str, request: FindingDraftRequest) -> Finding:
        audit = project_store.get_project(project_id)
        fieldwork = project_store.load_fieldwork(project_id)
        fieldwork_item = next((item for item in fieldwork.items if item.id == request.fieldwork_item_id), None)
        try:
            return await FindingAgent().run(audit, request, fieldwork_item)
        except (LLMProviderError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    async def draft(self, project_id: str, request: FindingDraftRequest) -> Finding:
        finding = await self.refine(project_id, request)
        return self.create(project_id, finding)

    def create(self, project_id: str, finding: Finding) -> Finding:
        fieldwork = project_store.load_fieldwork(project_id)
        fieldwork_item = next((item for item in fieldwork.items if item.id == finding.linked_fieldwork_item_id), None)
        findings = project_store.load_findings(project_id)
        findings.findings.append(finding)
        if fieldwork_item and finding.id not in fieldwork_item.finding_ids:
            fieldwork_item.finding_ids.append(finding.id)
            fieldwork_item.status = "Issue Identified"
            project_store.save_fieldwork(project_id, fieldwork)
        project_store.save_findings(project_id, findings)
        return finding

    def delete(self, project_id: str, finding_id: str) -> None:
        findings = project_store.load_findings(project_id)
        before = len(findings.findings)
        findings.findings = [finding for finding in findings.findings if finding.id != finding_id]
        if before == len(findings.findings):
            raise HTTPException(status_code=404, detail="Finding not found")
        project_store.save_findings(project_id, findings)

        fieldwork = project_store.load_fieldwork(project_id)
        changed = False
        for item in fieldwork.items:
            if finding_id in item.finding_ids:
                item.finding_ids = [item_id for item_id in item.finding_ids if item_id != finding_id]
                changed = True
        if changed:
            project_store.save_fieldwork(project_id, fieldwork)


finding_service = FindingService()
