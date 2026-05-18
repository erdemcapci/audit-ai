from fastapi import APIRouter, Response

from app.models import ReportState
from app.services.export_service import export_service
from app.services.report_service import report_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/reports", tags=["reports"])


@router.post("/generate-executive-summary", response_model=ReportState)
async def generate_executive_summary(project_id: str) -> ReportState:
    return await report_service.generate(project_id)


@router.post("/generate-draft-report", response_model=ReportState)
async def generate_draft_report(project_id: str) -> ReportState:
    return await report_service.generate(project_id)


@router.get("", response_model=ReportState)
def get_report(project_id: str) -> ReportState:
    return project_store.load_report(project_id)


@router.put("", response_model=ReportState)
def update_report(project_id: str, report: ReportState) -> ReportState:
    return project_store.save_report(project_id, report)


@router.get("/export-markdown")
def export_markdown(project_id: str) -> Response:
    markdown = export_service.export_markdown(project_id)
    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="audit-report.md"'},
    )
