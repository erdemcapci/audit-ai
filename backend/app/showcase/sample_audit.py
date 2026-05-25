from __future__ import annotations

from app.agents.demo_data import demo_document_requests, demo_finding, demo_interviews, demo_objectives, demo_report, demo_risks, demo_tests
from app.agents.report_agent import report_to_markdown
from app.config import settings
from app.models import AuditCreate, FieldworkCreateFromPlanningRequest
from app.services.fieldwork_service import fieldwork_service
from app.services.finding_service import finding_service
from app.store.project_store import project_store


def bootstrap_hosted_showcase() -> None:
    if settings.deployment_mode != "hosted":
        return
    ensure_public_sample_audit()


def ensure_public_sample_audit() -> None:
    if project_store.public_sample_projects():
        return
    audit = project_store.create_project(
        AuditCreate(
            title="Sample Procurement Audit",
            description="Public sample audit with demo data for evaluating AuditCopilot.",
            process_area="Procurement",
            initial_concern="Evaluate vendor onboarding, approvals, and evidence retention.",
        ),
        visibility="public_sample",
        is_read_only_sample=True,
    )
    planning = demo_tests(demo_risks(demo_objectives(audit.title, audit.description)))
    project_store.save_planning(audit.id, planning)
    fieldwork = fieldwork_service.create_from_planning(audit.id, FieldworkCreateFromPlanningRequest(mode="missing"))
    project_store.save_interviews(audit.id, demo_interviews(planning))
    documents = demo_document_requests([item.title for item in fieldwork.items], max_items=min(8, max(1, len(fieldwork.items))))
    project_store.save_document_requests(audit.id, documents)
    for item in fieldwork.items[:3]:
        finding_service.create(
            audit.id,
            demo_finding(
                raw_description=f"Sample testing for {item.title} identified a control exception for demonstration purposes.",
                fieldwork_item=item,
            ),
        )
    report = demo_report()
    report.draft_markdown = report_to_markdown(report)
    project_store.save_report(audit.id, report)
