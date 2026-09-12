from app.models import FieldworkItem, Finding


def demo_finding(raw_description: str, fieldwork_item: FieldworkItem | None = None) -> Finding:
    title = "Control exception requires management attention"
    if fieldwork_item:
        title = f"Exception noted in {fieldwork_item.title}"
    observation = raw_description.strip() or "Testing identified a control exception requiring follow-up."
    issue = (
        "Fieldwork identified a control exception that indicates the related process may not be operating consistently. "
        f"Based on the auditor's observation, the condition to validate is: {observation}"
    )
    return Finding(
        title=title,
        raw_description=raw_description,
        issue=issue,
        criteria="Management procedures and control expectations require consistent approval, evidence retention, and timely exception resolution.",
        root_cause="Ownership, system enforcement, or evidence retention expectations may not be sufficiently clear.",
        impact="The exception may increase the risk of unauthorized activity, inaccurate processing, or delayed detection.",
        recommendation="Clarify ownership, reinforce required evidence, and monitor exceptions until the control operates consistently.",
        management_action="Management should review the exception, confirm root cause, and document a corrective action owner and target date.",
        severity="Medium",
        evidence_needed=["Population and sample support", "Approval or review evidence", "Management explanation for exception"],
        validation_questions=["Is this exception isolated or recurring?", "Was compensating review performed?", "Who owns remediation?"],
        linked_fieldwork_item_id=fieldwork_item.id if fieldwork_item else None,
    )
