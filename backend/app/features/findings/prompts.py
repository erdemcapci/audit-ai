from app.agents.prompt_defaults import SYSTEM_PROMPT


FINDING_PROMPT = """Draft a structured internal audit finding from the rough description.
Return this JSON shape:
{
  "title": "...",
  "issue": "...",
  "criteria": "...",
  "root_cause": "...",
  "impact": "...",
  "recommendation": "...",
  "management_action": "...",
  "severity": "Low|Medium|High",
  "evidence_needed": ["..."],
  "validation_questions": ["..."]
}
Input:
{finding_context}
"""
