from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response

from app.agents.demo_data import demo_document_requests, demo_finding, demo_interviews, demo_objectives, demo_report, demo_risks, demo_tests
from app.agents.report_agent import report_to_markdown
from app.config import default_openai_model, settings
from app.models import (
    AdminLoginRequest,
    AdminMe,
    AdminUserAccessUpdate,
    AdminUserSummary,
    AuditCreate,
    AutoLayoutRequest,
    DemoCreateRequest,
    DemoJobStatus,
    DemoJobStep,
    DocumentRequestState,
    FieldworkCreateFromPlanningRequest,
)
from app.runtime import (
    clear_admin_cookie,
    is_admin_request,
    runtime_settings,
    set_admin_cookie,
)
from app.showcase.rate_limit import enforce_hosted_rate_limit
from app.services.audit_map_service import audit_map_service
from app.services.fieldwork_service import fieldwork_service
from app.services.finding_service import finding_service
from app.services.planning_service import planning_service
from app.store.project_store import project_store
from app.store.user_store import user_store


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


def _admin_user_summary(user) -> AdminUserSummary:
    remaining = max(0, user.ai_total_run_limit - user.ai_runs_used)
    return AdminUserSummary(
        id=user.id,
        email=user.email,
        canRunAgents=user.can_run_agents,
        aiTotalRunLimit=user.ai_total_run_limit,
        aiRunsUsed=user.ai_runs_used,
        aiRunsRemaining=remaining,
        aiModel=user.ai_model or default_openai_model(),
        createdAt=user.created_at,
        updatedAt=user.updated_at,
    )


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

        await _run_step(job, "Generate objectives", lambda: _create_demo_objectives(audit.id))
        await _run_step(job, "Generate risks", lambda: _create_demo_risks(audit.id))
        await _run_step(job, "Generate tests", lambda: _create_demo_tests(audit.id))
        await _run_step(job, "Approve planning", lambda: planning_service.approve(audit.id))
        await _run_step(
            job,
            "Create fieldwork items",
            lambda: fieldwork_service.create_from_planning(audit.id, FieldworkCreateFromPlanningRequest(mode="missing")),
        )
        await _run_step(job, "Generate interview plan", lambda: _create_demo_interviews(audit.id))
        await _run_step(job, "Generate document requests", lambda: _create_document_requests(audit.id))
        await _run_step(job, "Generate findings", lambda: _create_demo_findings(audit.id))
        await _run_step(job, "Generate report", lambda: _create_demo_report(audit.id))
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


def _create_demo_objectives(project_id: str):
    audit = project_store.get_project(project_id)
    planning = demo_objectives(audit.title, audit.description)
    return project_store.save_planning(project_id, planning)


def _create_demo_risks(project_id: str):
    planning = project_store.load_planning(project_id)
    return project_store.save_planning(project_id, demo_risks(planning))


def _create_demo_tests(project_id: str):
    planning = project_store.load_planning(project_id)
    return project_store.save_planning(project_id, demo_tests(planning))


def _create_demo_interviews(project_id: str):
    planning = project_store.load_planning(project_id)
    return project_store.save_interviews(project_id, demo_interviews(planning))


async def _create_demo_findings(project_id: str):
    fieldwork = project_store.load_fieldwork(project_id)
    selected_items = fieldwork.items[: max(1, min(3, len(fieldwork.items)))]
    created = []
    for item in selected_items:
        finding = finding_service.create(
            project_id,
            demo_finding(
                raw_description=f"Testing for {item.title} identified an exception requiring validation with management.",
                fieldwork_item=item,
            ),
        )
        created.append(finding)
    return created


def _create_demo_report(project_id: str):
    report = demo_report()
    findings = project_store.load_findings(project_id)
    if findings.findings:
        report.issue_summary = "; ".join(finding.title for finding in findings.findings)
        report.draft_markdown = ""
        report.draft_markdown = report_to_markdown(report)
    audit = project_store.get_project(project_id)
    audit.status = "reporting"
    project_store.save_project(audit)
    return project_store.save_report(project_id, report)


@router.post("/login", response_model=AdminMe)
def login(request: Request, response: Response, payload: AdminLoginRequest) -> AdminMe:
    enforce_hosted_rate_limit(request, "admin-login", settings.admin_rate_limit_attempts)
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


@router.get("/users", response_model=list[AdminUserSummary])
def list_users(request: Request) -> list[AdminUserSummary]:
    if not is_admin_request(request):
        raise HTTPException(status_code=403, detail="Admin login is required.")
    return [_admin_user_summary(user) for user in user_store.list_users()]


@router.put("/users/{user_id}/access", response_model=AdminUserSummary)
def update_user_access(request: Request, user_id: str, payload: AdminUserAccessUpdate) -> AdminUserSummary:
    if not is_admin_request(request):
        raise HTTPException(status_code=403, detail="Admin login is required.")
    try:
        return _admin_user_summary(
            user_store.update_access(
                user_id,
                payload.canRunAgents,
                ai_total_run_limit=payload.aiTotalRunLimit,
                ai_runs_used=payload.aiRunsUsed,
                ai_model=payload.aiModel,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/demo/create-full", response_model=DemoJobStatus)
async def create_full_demo(request: Request, payload: DemoCreateRequest) -> DemoJobStatus:
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
