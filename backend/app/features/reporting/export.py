from app.models import AuditProject, FieldworkState, FindingsState, PlanningState, ReportState
from app.store.project_store import project_store


def report_to_markdown(
    audit: AuditProject,
    planning: PlanningState,
    fieldwork: FieldworkState,
    findings: FindingsState,
    report: ReportState,
) -> str:
    if report.draft_markdown.strip():
        return report.draft_markdown.strip() + "\n"
    lines = [
        f"# {audit.title}",
        "",
        audit.description,
        "",
        "## Executive Summary",
        report.executive_summary or "Draft executive summary not generated yet.",
        "",
        "## Audit Conclusion",
        report.audit_conclusion or "Draft conclusion not generated yet.",
        "",
        "## Planning",
    ]
    for workstream in planning.workstreams:
        lines.append(f"### {workstream.name}")
        for objective in workstream.objectives:
            lines.append(f"- Objective: {objective.title}")
            for risk in objective.risks:
                lines.append(f"  - Risk: {risk.title} ({risk.severity})")
                for test in risk.tests:
                    lines.append(f"    - Test: {test.title} [{test.test_type}]")
    lines.extend(["", "## Fieldwork"])
    for item in fieldwork.items:
        lines.append(f"- {item.title}: {item.status}")
    lines.extend(["", "## Findings"])
    if findings.findings:
        for finding in findings.findings:
            lines.extend(
                [
                    f"### {finding.title}",
                    f"**Severity:** {finding.severity}",
                    "",
                    f"**Issue:** {finding.issue}",
                    "",
                    f"**Criteria:** {finding.criteria}",
                    "",
                    f"**Impact:** {finding.impact}",
                    "",
                    f"**Recommendation:** {finding.recommendation}",
                    "",
                ]
            )
    else:
        lines.append("No findings drafted yet.")
    lines.extend(["", "## Management Attention Points"])
    lines.extend([f"- {point}" for point in report.management_attention_points] or ["- None drafted yet."])
    return "\n".join(lines).strip() + "\n"


class ExportService:
    def export_markdown(self, project_id: str) -> str:
        markdown = report_to_markdown(
            project_store.get_project(project_id),
            project_store.load_planning(project_id),
            project_store.load_fieldwork(project_id),
            project_store.load_findings(project_id),
            project_store.load_report(project_id),
        )
        project_store.write_report_markdown(project_id, markdown)
        return markdown


export_service = ExportService()
