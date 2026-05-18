import json

from app.agents.demo_data import demo_report
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import REPORT_PROMPT, SYSTEM_PROMPT
from app.config import settings
from app.llm.router import get_llm_provider
from app.models import FieldworkState, FindingsState, PlanningState, ReportState


def report_to_markdown(report: ReportState) -> str:
    if report.draft_markdown.strip():
        return report.draft_markdown
    lines = ["# Draft Audit Report", ""]
    if report.executive_summary:
        lines.extend(["## Executive Summary", report.executive_summary, ""])
    if report.audit_conclusion:
        lines.extend(["## Audit Conclusion", report.audit_conclusion, ""])
    if report.key_themes:
        lines.append("## Key Themes")
        lines.extend(f"- {theme}" for theme in report.key_themes)
        lines.append("")
    if report.issue_summary:
        lines.extend(["## Issue Summary", report.issue_summary, ""])
    if report.management_attention_points:
        lines.append("## Management Attention Points")
        lines.extend(f"- {point}" for point in report.management_attention_points)
        lines.append("")
    if report.draft_report_structure:
        lines.append("## Draft Report Structure")
        for section in report.draft_report_structure:
            heading = section.get("heading") or "Section"
            content = section.get("content") or ""
            lines.extend([f"### {heading}", content, ""])
    return "\n".join(lines).strip() + "\n"


class ReportAgent:
    async def run(self, planning: PlanningState, fieldwork: FieldworkState, findings: FindingsState) -> ReportState:
        if settings.demo_mode:
            report = demo_report()
            if findings.findings:
                report.issue_summary = "; ".join(finding.title for finding in findings.findings)
                report.draft_markdown = report_to_markdown(report)
            return report
        context = json.dumps(
            {"planning": planning.model_dump(), "fieldwork": fieldwork.model_dump(), "findings": findings.model_dump()},
            indent=2,
        )
        response = await get_llm_provider().generate(SYSTEM_PROMPT, REPORT_PROMPT.format(report_context=context))
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        report = ReportState(**data)
        report.draft_markdown = report_to_markdown(report)
        return report
