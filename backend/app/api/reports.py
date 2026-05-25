from fastapi import APIRouter, Request, Response

from app.models import ReportState
from app.showcase.project_access import require_project_read, require_project_write
from app.runtime import ensure_agent_execution_allowed, record_successful_ai_run
from app.services.export_service import export_service
from app.services.report_service import report_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/reports", tags=["reports"])


@router.post("/generate-executive-summary", response_model=ReportState)
async def generate_executive_summary(project_id: str, request: Request) -> ReportState:
    require_project_write(request, project_id)
    ensure_agent_execution_allowed(request)
    report = await report_service.generate(project_id)
    record_successful_ai_run(request)
    return report


@router.post("/generate-draft-report", response_model=ReportState)
async def generate_draft_report(project_id: str, request: Request) -> ReportState:
    require_project_write(request, project_id)
    ensure_agent_execution_allowed(request)
    report = await report_service.generate(project_id)
    record_successful_ai_run(request)
    return report


@router.get("", response_model=ReportState)
def get_report(project_id: str, request: Request) -> ReportState:
    require_project_read(request, project_id)
    return project_store.load_report(project_id)


@router.put("", response_model=ReportState)
def update_report(project_id: str, report: ReportState, request: Request) -> ReportState:
    require_project_write(request, project_id)
    return project_store.save_report(project_id, report)


@router.get("/export-markdown")
def export_markdown(project_id: str, request: Request) -> Response:
    require_project_read(request, project_id)
    markdown = export_service.export_markdown(project_id)
    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="audit-report.md"'},
    )
