"""Normalize configurable canvas report output into the persisted report contract."""
from app.models import ReportState
from app.features.reporting.agent import report_to_markdown


def report_from_agent_data(data: dict) -> ReportState:
    draft_markdown = _first_text(data, ["draft_markdown", "report_markdown", "markdown", "report", "content"])
    report = ReportState(
        executive_summary=_first_text(data, ["executive_summary", "summary"]),
        audit_conclusion=_first_text(data, ["audit_conclusion", "conclusion"]),
        key_themes=_text_list(data.get("key_themes") or data.get("themes")),
        issue_summary=_first_text(data, ["issue_summary", "findings_summary"]),
        management_attention_points=_text_list(data.get("management_attention_points") or data.get("attention_points") or data.get("recommendations")),
        draft_report_structure=_report_sections(data.get("draft_report_structure") or data.get("sections")),
        ai_improved_version=_first_text(data, ["ai_improved_version", "improved_version"]),
        draft_markdown=draft_markdown,
    )
    if not report.draft_markdown.strip():
        report.draft_markdown = report_to_markdown(report)
    if not _report_has_content(report):
        raise ValueError("The model returned an empty draft report. Try a stronger local model or add temporary run content.")
    return report


def _report_has_content(report: ReportState) -> bool:
    meaningful = [
        report.executive_summary,
        report.audit_conclusion,
        report.issue_summary,
        report.ai_improved_version,
        *report.key_themes,
        *report.management_attention_points,
    ]
    meaningful.extend(str(section.get("content", "")) for section in report.draft_report_structure)
    if any(value.strip() for value in meaningful):
        return True
    return bool(report.draft_markdown.strip() and report.draft_markdown.strip() != "# Draft Audit Report")


def _first_text(data: dict, keys: list[str]) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _text_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _report_sections(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    sections: list[dict] = []
    for index, item in enumerate(value, start=1):
        if isinstance(item, dict):
            heading = str(item.get("heading") or item.get("title") or f"Section {index}").strip()
            content = str(item.get("content") or item.get("body") or item.get("text") or "").strip()
        else:
            heading = f"Section {index}"
            content = str(item).strip()
        if content:
            sections.append({"heading": heading or f"Section {index}", "content": content})
    return sections
