from app.agents.prompt_defaults import SYSTEM_PROMPT


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
          "test_type": "Test of Design|Test of Operating Effectiveness|Detailed Test|Analytical Review",
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
