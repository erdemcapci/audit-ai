from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response

from app.agents.demo_data import demo_document_requests
from app.config import settings
from app.models import (
    AdminLoginRequest,
    AdminMe,
    AuditCreate,
    AutoLayoutRequest,
    DemoCreateRequest,
    DemoJobStatus,
    DemoJobStep,
    DocumentRequestState,
    FieldworkCreateFromPlanningRequest,
    FindingDraftRequest,
)
from app.runtime import (
    clear_admin_cookie,
    ensure_agent_execution_allowed,
    is_admin_request,
    runtime_settings,
    set_admin_cookie,
)
from app.services.audit_map_service import audit_map_service
from app.services.fieldwork_service import fieldwork_service
from app.services.finding_service import finding_service
from app.services.interview_service import interview_service
from app.services.planning_service import planning_service
from app.services.report_service import report_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/admin", tags=["admin"])

DEMO_STEPS = [
    "Create audit project",
    "Generate objectives",
    "Generate risks",
    "Generate tests",
    "Approve planning",
    "Create fieldwork items",
    "Generate interview plan",
    "Generate document requests",
    "Generate findings",
    "Generate report",
    "Auto layout map",
]

jobs: dict[str, DemoJobStatus] = {}


def _new_job() -> DemoJobStatus:
    job_id = f"job_{uuid4().hex[:10]}"
    return DemoJobStatus(
        jobId=job_id,
        status="running",
        steps=[DemoJobStep(name=name) for name in DEMO_STEPS],
    )


def _set_step(job: DemoJobStatus, name: str, status: str) -> None:
    job.currentStep = name
    for step in job.steps:
        if step.name == name:
            step.status = status  # type: ignore[assignment]
            break


async def _run_step(job: DemoJobStatus, name: str, action):
    _set_step(job, name, "running")
    try:
        result = action()
        if asyncio.iscoroutine(result):
            result = await result
    except Exception:
        _set_step(job, name, "failed")
        raise
    _set_step(job, name, "completed")
    return result


async def _run_full_demo(job: DemoJobStatus, payload: DemoCreateRequest) -> None:
    try:
        audit = await _run_step(
            job,
            "Create audit project",
            lambda: project_store.create_project(
                AuditCreate(
                    title=payload.title,
                    description=payload.description,
                    process_area=payload.processArea,
                    initial_concern=payload.initialConcern,
                )
            ),
        )
        job.projectId = audit.id

        if not payload.runFullDemo:
            for step in job.steps[1:]:
                step.status = "completed"
            job.currentStep = "Create audit project"
            job.status = "completed"
            return

        await _run_step(job, "Generate objectives", lambda: planning_service.generate_objectives(audit.id))
        await _run_step(job, "Generate risks", lambda: planning_service.generate_risks(audit.id))
        await _run_step(job, "Generate tests", lambda: planning_service.generate_tests(audit.id))
        await _run_step(job, "Approve planning", lambda: planning_service.approve(audit.id))
        await _run_step(
            job,
            "Create fieldwork items",
            lambda: fieldwork_service.create_from_planning(audit.id, FieldworkCreateFromPlanningRequest(mode="missing")),
        )
        await _run_step(job, "Generate interview plan", lambda: interview_service.generate_plan(audit.id))
        await _run_step(job, "Generate document requests", lambda: _create_document_requests(audit.id))
        await _run_step(job, "Generate findings", lambda: _create_demo_findings(audit.id))
        await _run_step(job, "Generate report", lambda: report_service.generate(audit.id))
        await _run_step(job, "Auto layout map", lambda: audit_map_service.auto_layout(audit.id, AutoLayoutRequest()))
        job.status = "completed"
        job.currentStep = "Completed"
    except Exception as exc:
        job.error = str(exc)
        job.status = "partial" if job.projectId else "failed"


def _create_document_requests(project_id: str) -> DocumentRequestState:
    fieldwork = project_store.load_fieldwork(project_id)
    existing = project_store.load_document_requests(project_id)
    generated = demo_document_requests([item.title for item in fieldwork.items], max_items=min(10, max(1, len(fieldwork.items))))
    for index, request_item in enumerate(generated.requests):
        source = fieldwork.items[index % len(fieldwork.items)] if fieldwork.items else None
        request_item.source_node_id = source.id if source else None
        existing.requests.append(request_item)
    return project_store.save_document_requests(project_id, existing)


async def _create_demo_findings(project_id: str):
    fieldwork = project_store.load_fieldwork(project_id)
    selected_items = fieldwork.items[: max(1, min(3, len(fieldwork.items)))]
    created = []
    for item in selected_items:
        finding = await finding_service.draft(
            project_id,
            FindingDraftRequest(
                raw_description=f"Testing for {item.title} identified an exception requiring validation with management.",
                fieldwork_item_id=item.id,
            ),
        )
        created.append(finding)
    return created


@router.post("/login", response_model=AdminMe)
def login(request: Request, response: Response, payload: AdminLoginRequest) -> AdminMe:
    if not settings.admin_secret:
        raise HTTPException(status_code=403, detail="Admin access is not configured.")
    if payload.secret != settings.admin_secret:
        raise HTTPException(status_code=401, detail="Invalid admin secret.")
    set_admin_cookie(response)
    runtime = runtime_settings(request).model_copy(update={"isAdmin": True})
    if runtime.deploymentMode == "hosted":
        runtime.agentExecutionEnabled = runtime.adminEnabled and runtime.llmProviderConfigured
    return AdminMe(isAdmin=True, runtime=runtime)


@router.get("/me", response_model=AdminMe)
def me(request: Request) -> AdminMe:
    return AdminMe(isAdmin=is_admin_request(request), runtime=runtime_settings(request))


@router.post("/logout", response_model=AdminMe)
def logout(request: Request, response: Response) -> AdminMe:
    clear_admin_cookie(response)
    return AdminMe(isAdmin=False, runtime=runtime_settings(request))


@router.post("/demo/create-full", response_model=DemoJobStatus)
async def create_full_demo(request: Request, payload: DemoCreateRequest) -> DemoJobStatus:
    ensure_agent_execution_allowed(request)
    if not is_admin_request(request):
        raise HTTPException(status_code=403, detail="Admin login is required.")
    job = _new_job()
    jobs[job.jobId] = job
    asyncio.create_task(_run_full_demo(job, payload))
    return job


@router.get("/demo/jobs/{job_id}", response_model=DemoJobStatus)
def get_demo_job(request: Request, job_id: str) -> DemoJobStatus:
    if not is_admin_request(request):
        raise HTTPException(status_code=403, detail="Admin login is required.")
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Demo job not found.")
    return jobs[job_id]
