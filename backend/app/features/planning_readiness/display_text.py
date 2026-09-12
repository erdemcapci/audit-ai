"""Human-readable readiness text; machine reference fields are never rewritten."""
from collections import Counter
import re
from typing import TypeVar

from pydantic import BaseModel

from app.models import AuditProject, PlanningState

# The application's new_id uses a prefix and ten hexadecimal characters.
# Also cover unresolved references explicitly supplied in affected_artifact_ids.
GENERATED_ID = r"(?:audit|ws|obj|risk|test|agent|fw|finding|node|artifact)_[0-9a-fA-F]{10,32}"
TYPE_NAMES = {"obj": "objective", "ws": "workstream", "fw": "fieldwork item", "risk": "risk", "test": "test", "audit": "audit", "agent": "agent", "finding": "finding"}
TEXT_FIELDS = {"check_name", "category", "explanation", "recommended_action", "suggested_action", "branch", "summary", "executive_summary", "dimension", "error_message", "overall_explanation"}
TEXT_LISTS = {"strengths", "affected_artifact_names", "affected_workstreams"}
T = TypeVar("T", bound=BaseModel)


def artifact_catalog(audit: AuditProject, planning: PlanningState) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []

    def add(item, kind: str, title: str, parent: str = "", branch: str = ""):
        # A title can itself have been generated from an internal reference.
        clean = lambda value: re.sub(rf"(?<!\w){GENERATED_ID}(?!\w)", "", value).strip(" `\"'—-:")
        label = clean(title if title != item.id else "") or clean(item.description)[:160] or f"Untitled {kind}"
        entries.append({"internal_reference": item.id, "artifact_type": kind,
                        "display_label": label, "parent_reference": parent, "branch": branch})
        return label

    add(audit, "audit", audit.title)
    for workstream in planning.workstreams:
        workstream_label = add(workstream, "workstream", workstream.name, audit.id)
        for objective in workstream.objectives:
            objective_label = add(objective, "objective", objective.title, workstream.id, workstream_label)
            for risk in objective.risks:
                risk_label = add(risk, "risk", risk.title, objective.id, f"{workstream_label} / {objective_label}")
                for test in risk.tests:
                    add(test, "test", test.title, risk.id, f"{workstream_label} / {objective_label} / {risk_label}")
    counts = Counter(entry["display_label"] for entry in entries)
    for entry in entries:
        if counts[entry["display_label"]] > 1 and entry["branch"]:
            entry["display_label"] += f" ({entry['branch']})"
    return entries


def readable_readiness(value: T, catalog: list[dict[str, str]]) -> T:
    """Return a copy with only display fields normalized, including saved reviews.

    Known artifacts use actual plan labels. Deleted/unknown artifacts use their
    saved label when available, otherwise a neutral label, never an invented title.
    """
    payload = value.model_dump()
    labels = {entry["internal_reference"]: entry["display_label"] for entry in catalog}

    def fallback(reference: str) -> str:
        return f"the referenced {TYPE_NAMES.get(reference.split('_', 1)[0], 'audit-plan item')}"

    def collect(item):
        if isinstance(item, dict):
            ids = item.get("affected_artifact_ids", [])
            names = item.get("affected_artifact_names", [])
            for index, reference in enumerate(ids):
                # Only positional names with matching cardinality are reliable.
                name = names[index] if len(names) == len(ids) else ""
                labels.setdefault(reference, name if name and name != reference else fallback(reference))
            navigation = item.get("navigation") or {}
            if navigation.get("node_id"):
                labels.setdefault(navigation["node_id"], fallback(navigation["node_id"]))
            for child in item.values():
                collect(child)
        elif isinstance(item, list):
            for child in item:
                collect(child)

    collect(payload)
    references = sorted((re.escape(key) for key in labels if key), key=len, reverse=True)
    pattern = re.compile(r"(?<![\w])(?:" + "|".join([*references, GENERATED_ID]) + r")(?![\w])")
    # Clean labels too, without recursively substituting potentially cyclic IDs.
    labels = {key: pattern.sub(lambda match: fallback(match.group()), label) for key, label in labels.items()}

    def clean(text: str) -> str:
        # Backticks around IDs are implementation-oriented formatting, not labels.
        text = re.sub(r"`([^`]+)`", lambda match: match[1] if pattern.search(match[1]) else match[0], text)
        return pattern.sub(lambda match: f"“{labels[match.group()]}”" if match.group() in labels and not labels[match.group()].startswith("the referenced ") else labels.get(match.group(), fallback(match.group())), text)

    def walk(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if key in TEXT_FIELDS and isinstance(child, str):
                    item[key] = clean(child)
                elif key in TEXT_LISTS:
                    item[key] = [clean(text) for text in child]
                else:
                    walk(child)
            if "affected_artifact_ids" in item and item["affected_artifact_ids"]:
                item["affected_artifact_names"] = [labels[reference] for reference in item["affected_artifact_ids"]]
        elif isinstance(item, list):
            for child in item:
                walk(child)

    walk(payload)
    return type(value).model_validate(payload)
