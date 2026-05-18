from fastapi import APIRouter

from app.models import Finding, FindingDraftRequest, FindingsState
from app.services.finding_service import finding_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/findings", tags=["findings"])


@router.post("/draft", response_model=Finding)
async def draft_finding(project_id: str, request: FindingDraftRequest) -> Finding:
    return await finding_service.draft(project_id, request)


@router.post("/refine", response_model=Finding)
async def refine_finding(project_id: str, request: FindingDraftRequest) -> Finding:
    return await finding_service.refine(project_id, request)


@router.post("", response_model=Finding)
def create_finding(project_id: str, finding: Finding) -> Finding:
    return finding_service.create(project_id, finding)


@router.get("", response_model=FindingsState)
def get_findings(project_id: str) -> FindingsState:
    return project_store.load_findings(project_id)


@router.put("", response_model=FindingsState)
def update_findings(project_id: str, findings: FindingsState) -> FindingsState:
    return project_store.save_findings(project_id, findings)


@router.delete("/{finding_id}")
def delete_finding(project_id: str, finding_id: str) -> dict[str, str]:
    finding_service.delete(project_id, finding_id)
    return {"status": "deleted"}
