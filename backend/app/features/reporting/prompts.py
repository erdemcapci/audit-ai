from app.agents.prompt_defaults import SYSTEM_PROMPT


REPORT_PROMPT = """Generate reporting content from the audit planning, fieldwork, and findings.
Return this JSON shape:
{
  "executive_summary": "...",
  "audit_conclusion": "...",
  "key_themes": ["..."],
  "issue_summary": "...",
  "management_attention_points": ["..."],
  "draft_report_structure": [
    {"heading": "...", "content": "..."}
  ],
  "ai_improved_version": "..."
}
Audit materials:
{report_context}
"""
