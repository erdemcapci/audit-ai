from __future__ import annotations

from typing import Any


def compact_audit(audit: Any) -> dict[str, Any]:
    return {
        "id": audit.id,
        "title": audit.title,
        "description": audit.description,
        "process_area": audit.process_area,
        "initial_concern": audit.initial_concern,
        "extra_context": audit.extra_context,
        "status": audit.status,
    }


def compact_planning(planning: Any) -> dict[str, Any]:
    return {
        "stage": planning.stage,
        "approved": planning.approved,
        "workstreams": [
            {
                "id": workstream.id,
                "name": workstream.name,
                "description": workstream.description,
                "rationale": workstream.rationale,
                "status": workstream.status,
                "objectives": [
                    {
                        "id": objective.id,
                        "title": objective.title,
                        "description": objective.description,
                        "scope_notes": objective.scope_notes,
                        "rationale": objective.rationale,
                        "status": objective.status,
                        "risks": [
                            {
                                "id": risk.id,
                                "title": risk.title,
                                "description": risk.description,
                                "why_it_matters": risk.why_it_matters,
                                "potential_impact": risk.potential_impact,
                                "severity": risk.severity,
                                "status": risk.status,
                                "tests": [
                                    {
                                        "id": test.id,
                                        "title": test.title,
                                        "test_type": test.test_type,
                                        "test_objective": test.test_objective,
                                        "description": test.description,
                                        "expected_evidence": test.expected_evidence,
                                        "sample_considerations": test.sample_considerations,
                                        "status": test.status,
                                    }
                                    for test in risk.tests
                                ],
                            }
                            for risk in objective.risks
                        ],
                    }
                    for objective in workstream.objectives
                ],
            }
            for workstream in planning.workstreams
        ],
        "assumptions": planning.assumptions,
        "open_questions": planning.open_questions,
    }


def compact_fieldwork(fieldwork: Any) -> dict[str, Any]:
    return {
        "items": [
            {
                "id": item.id,
                "test_id": item.test_id,
                "source_test_id": item.source_test_id,
                "title": item.title,
                "test_type": item.test_type,
                "description": item.description,
                "expected_evidence": item.expected_evidence,
                "status": item.status,
                "notes": item.notes,
                "evidence_placeholder": item.evidence_placeholder,
                "findings_count": len(item.finding_ids),
            }
            for item in fieldwork.items
        ]
    }


def compact_findings(findings: Any) -> dict[str, Any]:
    return {
        "findings": [
            {
                "id": finding.id,
                "title": finding.title,
                "issue": finding.issue,
                "criteria": finding.criteria,
                "root_cause": finding.root_cause,
                "impact": finding.impact,
                "recommendation": finding.recommendation,
                "management_action": finding.management_action,
                "severity": finding.severity,
                "linked_fieldwork_item_id": finding.linked_fieldwork_item_id,
                "status": finding.status,
            }
            for finding in findings.findings
        ]
    }
