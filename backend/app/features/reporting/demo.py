from app.models import ReportState


def demo_report() -> ReportState:
    executive_summary = "The audit identified generally understood process ownership with opportunities to strengthen control evidence, exception tracking, and management visibility."
    audit_conclusion = "Controls appear directionally appropriate, but selected areas require remediation before management can rely on consistent operation."
    issue_summary = "Findings noted during fieldwork should be validated with process owners and prioritized by severity."
    draft_structure = [
        {"heading": "Background", "content": "Summary of audit scope and process context."},
        {"heading": "Scope and Approach", "content": "Planning, evidence review, and selected testing."},
        {"heading": "Findings", "content": "Detailed issues, impact, and recommendations."},
        {"heading": "Conclusion", "content": "Overall control assessment and management next steps."},
    ]
    return ReportState(
        executive_summary=executive_summary,
        audit_conclusion=audit_conclusion,
        key_themes=["Evidence retention should be more consistent.", "Exception ownership should be clearer.", "System reports can improve monitoring."],
        issue_summary=issue_summary,
        management_attention_points=["Confirm accountable owners.", "Agree remediation dates.", "Track open exceptions through closure."],
        draft_report_structure=draft_structure,
        ai_improved_version="The audit indicates a workable control framework with targeted improvements needed around documentation, exception handling, and accountability.",
        draft_markdown=(
            "# Draft Audit Report\n\n"
            "## Executive Summary\n"
            f"{executive_summary}\n\n"
            "## Audit Conclusion\n"
            f"{audit_conclusion}\n\n"
            "## Key Themes\n"
            "- Evidence retention should be more consistent.\n"
            "- Exception ownership should be clearer.\n"
            "- System reports can improve monitoring.\n\n"
            "## Issue Summary\n"
            f"{issue_summary}\n\n"
            "## Management Attention Points\n"
            "- Confirm accountable owners.\n"
            "- Agree remediation dates.\n"
            "- Track open exceptions through closure.\n"
        ),
    )
