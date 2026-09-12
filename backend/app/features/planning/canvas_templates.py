"""Deterministic planning output templates used by canvas agents."""
import re

from app.features.planning.demo import demo_objectives
from app.models import Objective, Risk, Test, Workstream


def normalize_theme(value: str) -> str:
    words = re.findall(r"[a-z0-9]+", value.lower())
    stop_words = {
        "a",
        "an",
        "and",
        "are",
        "assess",
        "audit",
        "control",
        "controls",
        "for",
        "in",
        "of",
        "or",
        "process",
        "review",
        "the",
        "to",
    }
    return " ".join(word for word in words if word not in stop_words)


def theme_is_covered(candidate: str, existing_titles: list[str]) -> bool:
    candidate_terms = set(normalize_theme(candidate).split())
    if not candidate_terms:
        return False
    for title in existing_titles:
        existing_terms = set(normalize_theme(title).split())
        if not existing_terms:
            continue
        overlap = candidate_terms & existing_terms
        if candidate_terms <= existing_terms or existing_terms <= candidate_terms or len(overlap) >= min(2, len(candidate_terms)):
            return True
    return False


def coverage_candidates(candidates: list, existing_titles: list[str], count: int) -> list:
    selected = []
    for candidate in candidates:
        title = candidate[0] if isinstance(candidate, tuple) else getattr(candidate, "name", getattr(candidate, "title", str(candidate)))
        if not theme_is_covered(str(title), existing_titles + [str(item[0] if isinstance(item, tuple) else getattr(item, "name", getattr(item, "title", str(item)))) for item in selected]):
            selected.append(candidate)
        if len(selected) >= count:
            return selected
    for candidate in candidates:
        if len(selected) >= count:
            return selected
        if candidate not in selected:
            selected.append(candidate)
    return selected


def risk_catalog(objective: Objective) -> list[tuple[str, str, str]]:
    return [
        ("Control design does not address the objective", "The process may not include a clear control to address the stated audit objective.", "High"),
        ("Control execution is inconsistent", "Control owners may not perform the control consistently or retain evidence.", "Medium"),
        ("Exception identification and escalation are weak", "Exceptions may not be identified, escalated, resolved, or reported to management.", "Medium"),
        ("Evidence retention is incomplete", "Control evidence may not be retained in a way that supports auditability and management review.", "Medium"),
        ("Ownership and accountability are unclear", "Roles, handoffs, or decision rights may not be clear enough to ensure consistent process execution.", "Medium"),
        ("System configuration does not enforce the control", "Workflow, access, or system rules may not prevent bypass or inconsistent processing.", "High"),
        ("Monitoring does not detect issues timely", "Management reporting or monitoring may not identify trends, aged exceptions, or recurring control failures.", "Medium"),
        ("Data quality affects control reliability", "Incomplete, inaccurate, or stale data may reduce the effectiveness of the control activity.", "Medium"),
    ]


def risk_templates(index: int, objective: Objective, existing_titles: list[str]) -> Risk:
    catalog = coverage_candidates(risk_catalog(objective), existing_titles, index + 1)
    title, description, severity = catalog[index % len(catalog)]
    return Risk(
        title=f"{title}: {objective.title[:48]}",
        description=description,
        why_it_matters="This can reduce management's ability to rely on the process and detect issues promptly.",
        potential_impact="Operational errors, compliance gaps, financial misstatement, or unresolved exceptions.",
        severity=severity,
    )


def test_catalog(risk: Risk, allowed_types: list[str]) -> list[tuple[str, str, str, str]]:
    return [
        ("Evaluate control design", allowed_types[0] if allowed_types else "Test of Design", "Policy, control description, workflow design, RACI, and approval matrix.", "Confirm whether the control is designed to mitigate the risk."),
        ("Test operating evidence", allowed_types[1 % len(allowed_types)] if allowed_types else "Detailed Test", "Completed transactions, approval trail, review evidence, and exception logs.", "Validate whether the control operated consistently for selected items."),
        ("Inspect exception handling", "Detailed Test", "Exception register, escalation evidence, remediation actions, and management review records.", "Assess whether exceptions are identified, escalated, and resolved."),
        ("Reconcile system report to source records", "Analytical Review", "System extract, source population, reconciliation support, and variance explanations.", "Evaluate completeness and accuracy of the population used for control operation."),
        ("Review access or configuration settings", "Test of Design", "Configuration screenshots, access listings, workflow rules, and change history.", "Determine whether system settings support the intended control."),
        ("Analyze trends and recurring exceptions", "Analytical Review", "Trend report, exception aging, repeat offender analysis, and management dashboards.", "Identify patterns that may indicate control weakness."),
        ("Perform targeted sample of high-risk items", "Detailed Test", "High-value, unusual, late, manual, or override transaction support.", "Focus testing on transactions most likely to expose the risk."),
    ]


def test_templates(index: int, risk: Risk, allowed_types: list[str], agent_id: str, existing_titles: list[str]) -> Test:
    catalog = coverage_candidates(test_catalog(risk, allowed_types), existing_titles, index + 1)
    title, test_type, evidence, objective = catalog[index % len(catalog)]
    return Test(
        title=f"{title} for {risk.title[:46]}",
        test_type=test_type,
        test_objective=f"{objective} Related risk: {risk.title}.",
        description=f"Perform audit procedures addressing the risk that {risk.description.lower()}",
        expected_evidence=evidence,
        sample_considerations="Use a recent sample covering normal, exception, and higher-risk items where practical.",
        generated_by_agent_id=agent_id,
    )


def workstream_templates(title: str, description: str, count: int, existing_titles: list[str]) -> list[Workstream]:
    generated = demo_objectives(title, description).workstreams
    generic = [
        Workstream(name="Governance and Accountability", description="Review process ownership, decision rights, policies, and oversight.", rationale="Governance coverage helps frame accountability and management review expectations."),
        Workstream(name="System and Data Controls", description="Review key system rules, access, workflow configuration, and data quality.", rationale="System and data controls often determine whether process controls operate consistently."),
        Workstream(name="Exception Management", description="Review how exceptions are detected, escalated, remediated, and monitored.", rationale="Exception management coverage helps identify whether issues are visible and resolved timely."),
        Workstream(name="Reporting and Monitoring", description="Review management reporting, KPIs, dashboards, and trend monitoring.", rationale="Monitoring coverage helps assess whether management can identify recurring control concerns."),
    ]
    candidates = [Workstream(name=item.name, description=item.description, rationale=item.rationale) for item in generated] + generic
    return coverage_candidates(candidates, existing_titles, count)


def objective_templates(index: int, workstream: Workstream, existing_titles: list[str]) -> Objective:
    candidates = [
        f"Assess {workstream.name.lower()} control design",
        f"Evaluate {workstream.name.lower()} operating effectiveness",
        f"Review {workstream.name.lower()} evidence retention",
        f"Assess {workstream.name.lower()} exception management",
        f"Evaluate {workstream.name.lower()} ownership and accountability",
        f"Review {workstream.name.lower()} system and data dependencies",
        f"Assess {workstream.name.lower()} monitoring and reporting",
    ]
    selected = coverage_candidates(candidates, existing_titles, index + 1)
    title = selected[index % len(selected)]
    return Objective(
        title=title,
        description=f"Determine whether {workstream.name.lower()} controls are appropriately designed, evidenced, and operating as intended.",
        scope_notes=f"Focus on current procedures, key systems, approval paths, exception handling, and retained evidence for {workstream.name.lower()}.",
        rationale=f"{workstream.name} is included in scope and needs clear objectives before risks and tests are generated.",
    )
