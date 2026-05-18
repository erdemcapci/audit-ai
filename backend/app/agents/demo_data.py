from app.models import (
    DocumentRequest,
    DocumentRequestState,
    FieldworkItem,
    Finding,
    InterviewPlan,
    InterviewQuestion,
    InterviewRole,
    Objective,
    PlanningState,
    ReportState,
    Risk,
    Test,
    Workstream,
)


def _topic(title: str) -> str:
    lowered = title.lower()
    if "procure" in lowered or "vendor" in lowered or "purchase" in lowered:
        return "procurement"
    if "access" in lowered or "identity" in lowered:
        return "access"
    if "payroll" in lowered:
        return "payroll"
    return "operations"


def demo_objectives(title: str, description: str) -> PlanningState:
    topic = _topic(title)
    if topic == "procurement":
        names = [
            "Procurement Governance",
            "Vendor Selection",
            "Purchase Approval",
            "Invoice Matching",
            "Segregation of Duties",
        ]
    elif topic == "access":
        names = ["Access Governance", "Provisioning", "Privileged Access", "Periodic Review", "Termination Controls"]
    else:
        names = ["Governance", "Process Design", "Control Operation", "Data Quality", "Exception Management"]
    workstreams = []
    for name in names:
        objective = Objective(
            title=f"Assess {name.lower()} controls",
            description=f"Determine whether controls over {name.lower()} are designed to address the audit objective.",
            scope_notes=f"Focus on the current process, key systems, approval paths, and retained evidence for {name.lower()}.",
            rationale=f"{name} is a meaningful source of operational, financial, or compliance risk for this audit.",
        )
        workstreams.append(
            Workstream(
                name=name,
                description=f"Review the process area covering {name.lower()}.",
                rationale=f"Included because the audit description indicates exposure related to {description[:120] or title}.",
                objectives=[objective],
            )
        )
    return PlanningState(
        stage="objectives_generated",
        workstreams=workstreams,
        assumptions=["Process owners can provide current procedures and evidence.", "Testing will use recent completed transactions."],
        open_questions=["Which systems are in scope?", "What period should be tested?", "Are there known exceptions or incidents?"],
    )


def demo_risks(planning: PlanningState) -> PlanningState:
    examples = [
        ("Unauthorized purchases", "Purchases may be initiated or approved outside delegated authority.", "High"),
        ("Vendor onboarding without due diligence", "Vendors may be added without required screening or approval.", "High"),
        ("Duplicate or incorrect payments", "Invoices may be paid without complete matching to purchase and receipt evidence.", "Medium"),
        ("Approval limits not followed", "Transactions may bypass approval thresholds or required reviewers.", "Medium"),
        ("Conflicting access rights", "Users may hold incompatible roles that allow initiating and approving the same activity.", "High"),
    ]
    index = 0
    for workstream in planning.workstreams:
        for objective in workstream.objectives:
            if objective.risks:
                continue
            for _ in range(2):
                title, description, severity = examples[index % len(examples)]
                objective.risks.append(
                    Risk(
                        title=title,
                        description=description,
                        why_it_matters="The risk can weaken accountability and allow errors or misuse to go undetected.",
                        potential_impact="Financial loss, inaccurate records, compliance breaches, or management reporting gaps.",
                        severity=severity,
                    )
                )
                index += 1
    planning.stage = "risks_generated"
    return planning


def demo_tests(planning: PlanningState) -> PlanningState:
    catalog = [
        ("Review approval matrix", "Test of Design", "Approval policy, delegation matrix, workflow configuration"),
        ("Test sample of purchase orders", "Test of Operating Effectiveness", "Approved purchase orders and approval trail"),
        ("Inspect vendor onboarding evidence", "Detailed Test", "Vendor due diligence checklist and approval evidence"),
        ("Compare invoices to purchase orders and goods receipts", "Detailed Test", "Invoice, PO, goods receipt, payment record"),
        ("Review user access roles", "Analytical Review", "User listing, role matrix, privileged access report"),
    ]
    index = 0
    for workstream in planning.workstreams:
        for objective in workstream.objectives:
            for risk in objective.risks:
                if risk.tests:
                    continue
                title, test_type, evidence = catalog[index % len(catalog)]
                risk.tests.append(
                    Test(
                        title=title,
                        test_type=test_type,
                        test_objective=f"Determine whether controls mitigate: {risk.title}.",
                        description=f"Perform procedures to validate that {risk.description.lower()}",
                        expected_evidence=evidence,
                        sample_considerations="Use a recent sample covering normal and exception transactions where available.",
                    )
                )
                index += 1
    planning.stage = "tests_generated"
    return planning


def demo_interviews(planning: PlanningState, max_roles: int = 3, questions_per_role: int = 3) -> InterviewPlan:
    objective_id = planning.workstreams[0].objectives[0].id if planning.workstreams and planning.workstreams[0].objectives else None
    roles = [
        ("Process Owner", "Explain end-to-end process design, decision rights, and known pain points."),
        ("Control Owner", "Describe control operation, evidence retained, and exception handling."),
        ("System Owner", "Confirm workflow configuration, access model, and audit trail availability."),
        ("Operations Lead", "Explain day-to-day execution, handoffs, and recurring exceptions."),
        ("Compliance Officer", "Confirm policy requirements, monitoring expectations, and compliance concerns."),
    ]
    question_templates = [
        lambda: InterviewQuestion(question_text="Walk us through the process from initiation to completion.", mapped_objective_id=objective_id),
        lambda: InterviewQuestion(question_text="Which controls are most important, and where do exceptions occur?"),
        lambda: InterviewQuestion(question_text="What evidence is retained to demonstrate the control operated?"),
        lambda: InterviewQuestion(question_text="What changes, incidents, or known issues should the audit consider?"),
        lambda: InterviewQuestion(question_text="Which reports or system records would best support audit testing?"),
    ]
    return InterviewPlan(
        roles=[
            InterviewRole(
                role_title=role,
                rationale=f"{role} is likely to hold information needed to validate planning assumptions.",
                expected_information=expected,
                questions=[template() for template in question_templates[: max(1, questions_per_role)]],
            )
            for role, expected in roles[: max(1, max_roles)]
        ]
    )


def demo_document_requests(source_titles: list[str], max_items: int = 8) -> DocumentRequestState:
    titles = source_titles or ["Fieldwork evidence"]
    requests: list[DocumentRequest] = []
    for index, title in enumerate(titles[: max(1, max_items)], start=1):
        requests.append(
            DocumentRequest(
                title=f"Request evidence for {title[:64]}",
                description="Ask the process owner to provide the evidence needed to perform or validate this audit procedure.",
                requested_from="Process Owner",
                expected_document="Policy, approval trail, transaction support, system report, or other retained control evidence.",
                rationale="This evidence supports fieldwork execution and helps validate whether the related control activity operated as expected.",
            )
        )
    return DocumentRequestState(requests=requests)


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


def demo_report() -> ReportState:
    executive_summary = "The audit identified generally understood process ownership with opportunities to strengthen control evidence, exception tracking, and management visibility."
    audit_conclusion = "Controls appear directionally appropriate, but selected areas require remediation before management can rely on consistent operation."
    issue_summary = "Findings noted during fieldwork should be validated with process owners and prioritized by severity."
    draft_structure = [
        {"heading": "Background", "content": "Summary of audit scope and process context."},
        {"heading": "Scope and Approach", "content": "Planning, interviews, evidence review, and selected testing."},
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
