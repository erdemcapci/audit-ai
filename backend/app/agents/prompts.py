SYSTEM_PROMPT = """You are an internal audit planning copilot.
Return valid JSON only. Do not include markdown, comments, or explanatory prose.
Use practical internal audit language, avoid generic consulting phrases, and keep outputs concise enough for a working auditor to edit."""


OBJECTIVES_PROMPT = """Create audit workstreams and objectives for this audit.
Return this JSON shape:
{
  "workstreams": [
    {
      "name": "...",
      "description": "...",
      "rationale": "...",
      "objectives": [
        {"title": "...", "description": "...", "scope_notes": "...", "rationale": "..."}
      ]
    }
  ],
  "assumptions": ["..."],
  "open_questions": ["..."]
}
Audit input:
{audit_context}
"""


RISKS_PROMPT = """Generate risks for each confirmed objective.
Return this JSON shape:
{
  "risks_by_objective": [
    {
      "objective_id": "...",
      "risks": [
        {
          "title": "...",
          "description": "...",
          "why_it_matters": "...",
          "potential_impact": "...",
          "severity": "Low|Medium|High"
        }
      ]
    }
  ]
}
Audit and planning input:
{planning_context}
"""


TESTS_PROMPT = """Generate audit tests for each confirmed risk.
Return this JSON shape:
{
  "tests_by_risk": [
    {
      "risk_id": "...",
      "tests": [
        {
          "title": "...",
          "test_type": "Test of Design|Test of Operating Effectiveness|Detailed Test|Analytical Review|Inquiry / Interview",
          "test_objective": "...",
          "description": "...",
          "expected_evidence": "...",
          "sample_considerations": "..."
        }
      ]
    }
  ]
}
Audit, objectives, and risks:
{planning_context}
"""


INTERVIEW_PROMPT = """Generate an interview plan mapped to the current planning hierarchy where possible.
Return this JSON shape:
{
  "roles": [
    {
      "role_title": "...",
      "rationale": "...",
      "expected_information": "...",
      "questions": [
        {
          "question_text": "...",
          "mapped_objective_id": null,
          "mapped_risk_id": null,
          "mapped_test_id": null
        }
      ]
    }
  ]
}
Planning hierarchy:
{planning_context}
"""


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
