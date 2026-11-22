from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.features.data_quality.ai_plan import data_quality_ai_plan_service
from app.features.data_quality.models import AiPlanRequest, AiPlanResponse, DataQualityRun, DataQualityRunCreate, DataQualityRunSummary, SavedRule, StoredSourceFile
from app.features.data_quality.store import data_quality_store
from app.models import MessageResponse
from app.runtime import actor_id_for_request, ensure_agent_execution_allowed, ensure_data_quality_write_allowed


router = APIRouter(prefix="/api/projects/{project_id}/data-quality", tags=["data-quality"])

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@router.get("/runs", response_model=list[DataQualityRunSummary])
def list_runs(project_id: str) -> list[DataQualityRunSummary]:
    return data_quality_store.list_runs(project_id)


@router.get("/runs/{run_id}", response_model=DataQualityRun)
def get_run(project_id: str, run_id: str) -> DataQualityRun:
    return data_quality_store.get_run(project_id, run_id)


@router.post("/runs", response_model=DataQualityRun)
def create_run(request: Request, project_id: str, payload: DataQualityRunCreate) -> DataQualityRun:
    ensure_data_quality_write_allowed(request)
    return data_quality_store.create_run(project_id, payload)


@router.delete("/runs/{run_id}", response_model=MessageResponse)
def delete_run(request: Request, project_id: str, run_id: str) -> MessageResponse:
    ensure_data_quality_write_allowed(request)
    data_quality_store.delete_run(project_id, run_id)
    return MessageResponse(message="Run deleted")


@router.post("/files", response_model=StoredSourceFile)
async def upload_file(request: Request, project_id: str) -> StoredSourceFile:
    """Body: the gzip-compressed source file. Returns the SHA-256 of its uncompressed content."""
    ensure_data_quality_write_allowed(request)
    if int(request.headers.get("content-length") or 0) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The source file is too large to store.")
    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The source file is too large to store.")
    return data_quality_store.store_file(project_id, body)


@router.get("/files/{content_hash}")
def download_file(project_id: str, content_hash: str) -> FileResponse:
    return FileResponse(data_quality_store.file_path(project_id, content_hash), media_type="application/gzip")


@router.post("/plan", response_model=AiPlanResponse)
async def ai_plan(request: Request, project_id: str, payload: AiPlanRequest) -> AiPlanResponse:
    """AI review of the proposed test plan. Nothing is saved here; the run saves what the auditor accepts."""
    ensure_data_quality_write_allowed(request)
    ensure_agent_execution_allowed(request)
    try:
        return await data_quality_ai_plan_service.review(project_id, payload, actor_id_for_request(request))
    except FileNotFoundError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"The AI review could not be completed: {exc}") from exc


@router.get("/rules", response_model=list[SavedRule])
def list_rules(project_id: str) -> list[SavedRule]:
    return data_quality_store.list_rules(project_id)


@router.put("/rules", response_model=list[SavedRule])
def save_rules(request: Request, project_id: str, rules: list[SavedRule]) -> list[SavedRule]:
    ensure_data_quality_write_allowed(request)
    return data_quality_store.save_rules(project_id, rules)


@router.delete("/files/{content_hash}", response_model=MessageResponse)
def delete_file(request: Request, project_id: str, content_hash: str) -> MessageResponse:
    ensure_data_quality_write_allowed(request)
    data_quality_store.delete_file(project_id, content_hash)
    return MessageResponse(message="Source file deleted")
