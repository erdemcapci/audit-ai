from app.models import Objective, PlanningState, Risk, Test, Workstream


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
