"""AI review of a data quality test plan (AI #1). The model only proposes; the browser engine validates
every proposal against the file before anything runs, and the auditor accepts or changes the result."""
from __future__ import annotations

import re
from typing import Any

from app.config import settings
from app.features.data_quality.models import (
    SEMANTIC_ROLES,
    AiColumnRole,
    AiIdea,
    AiNewRule,
    AiPlanRequest,
    AiPlanResponse,
    AiTestChange,
)
from app.features.data_quality.prompts import build_plan_prompts
from app.llm.json_utils import parse_or_warn
from app.llm.router import get_llm_provider
from app.models import AgentState
from app.services.agent_run_log_service import agent_run_log_service
from app.store.project_store import project_store

LOG_AGENT = AgentState(id="data_quality_ai_plan", type="data_quality_ai_plan", title="Data quality: AI test plan", prompt="")
RULE_KINDS = {"compare", "conditional", "dependency", "arithmetic"}
MAX_RULES = 8
MAX_SWITCH_OFF = 5
MAX_IDEAS = 5
MAX_TEXT = 300


class DataQualityAiPlanService:
    async def review(self, project_id: str, request: AiPlanRequest, actor_id: str) -> AiPlanResponse:
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        system_prompt, user_prompt = build_plan_prompts(request, audit, planning)
        estimated_tokens = (len(system_prompt) + len(user_prompt)) // 4
        demo = settings.demo_mode
        provider_name = "demo" if demo else settings.llm_provider
        model_name = "deterministic-demo" if demo else ""
        log_id = agent_run_log_service.start_run(
            project_id=project_id,
            actor_id=actor_id,
            agent=LOG_AGENT,
            provider=provider_name,
            model=model_name,
            selected_item_ids=[],
            context_recipe_id="data_quality_plan",
            context_blocks_used=["audit", "columns", "relationships", "sample_rows", "tests"],
            estimated_context_tokens=estimated_tokens,
            context_truncated=False,
            rendered_context=user_prompt,
        )
        raw: Any = None
        try:
            if demo:
                data, provider_name, model_name = demo_plan(request), "demo", "deterministic-demo"
            else:
                response = await get_llm_provider().generate(system_prompt, user_prompt, json_mode=True)
                provider_name, model_name, raw = response.provider, response.model, response.raw_response
                data, warning = parse_or_warn(response.content)
                if data is None:
                    raise ValueError(warning)
            result = normalize(data, request)
        except Exception as exc:
            agent_run_log_service.fail_run(project_id, log_id, error_message=str(exc), provider=provider_name, model=model_name,
                                           final_prompt={"system": system_prompt, "user": user_prompt}, raw_llm_response=raw)
            raise
        result = result.model_copy(update={
            "provider": provider_name, "model": model_name, "demo": demo, "log_run_id": log_id,
            "estimated_tokens": estimated_tokens, "sample_rows_sent": len(request.sample_rows),
        })
        agent_run_log_service.complete_run(project_id, log_id, provider=provider_name, model=model_name, output_object_ids=[],
                                           final_prompt={"system": system_prompt, "user": user_prompt},
                                           parsed_output=result.model_dump(), raw_llm_response=raw)
        return result


def _text(value: Any) -> str:
    return str(value or "").strip()[:MAX_TEXT]


def _constants_as_text(rule: dict[str, Any]) -> dict[str, Any]:
    """Models often write numbers unquoted ("value": 0); the engine compares constants given as text."""
    fixed = dict(rule)
    for key in ("if", "then"):
        condition = fixed.get(key)
        if isinstance(condition, dict):
            condition = dict(condition)
            if isinstance(condition.get("value"), (int, float)) and not isinstance(condition.get("value"), bool):
                condition["value"] = str(condition["value"])
            if isinstance(condition.get("values"), list):
                condition["values"] = [str(v) for v in condition["values"]]
            fixed[key] = condition
    return fixed


def normalize(data: dict[str, Any], request: AiPlanRequest) -> AiPlanResponse:
    """Keeps only what refers to this file and plan. Rule contents are checked by the engine, which knows the columns."""
    names = {c.name for c in request.columns}
    tests = {t.id: t for t in request.tests}
    items = lambda key: [item for item in (data.get(key) or []) if isinstance(item, dict)]  # noqa: E731

    columns: list[AiColumnRole] = []
    for item in items("columns"):
        name, role = _text(item.get("column")), _text(item.get("role"))
        if name in names and not any(c.column == name for c in columns):
            columns.append(AiColumnRole(column=name, role=role if role in SEMANTIC_ROLES else "other", meaning=_text(item.get("meaning"))))

    def changes(key: str, currently_enabled: bool) -> list[AiTestChange]:
        found: list[AiTestChange] = []
        for item in items(key):
            test_id = _text(item.get("test_id"))
            test = tests.get(test_id)
            if test and test.enabled == currently_enabled and not any(c.test_id == test_id for c in found):
                found.append(AiTestChange(test_id=test_id, reason=_text(item.get("reason"))))
        return found

    rules: list[AiNewRule] = []
    for item in items("new_rules")[:MAX_RULES]:
        rule = item.get("rule")
        if isinstance(rule, dict) and rule.get("kind") in RULE_KINDS:
            rules.append(AiNewRule(rule=_constants_as_text(rule), reason=_text(item.get("reason"))))

    ideas = [AiIdea(idea=_text(item.get("idea")), reason=_text(item.get("reason"))) for item in items("not_testable")[:MAX_IDEAS] if _text(item.get("idea"))]
    return AiPlanResponse(
        summary=_text(data.get("summary")),
        columns=columns,
        # A guard on top of the prompt: an AI that switches off much of the plan defeats the tests' purpose.
        switch_off=changes("switch_off", True)[:MAX_SWITCH_OFF],
        switch_on=changes("switch_on", False),
        new_rules=rules,
        not_testable=ideas,
    )


# Demo mode: fixed rules stand in for the model, so the AI step can be shown without a provider.
ROLE_HINTS: list[tuple[str, str]] = [
    (r"invoice.?(no|num|nr)|document|doc.?(no|num|id)|belnr|order.?(no|num)", "document_number"),
    (r"(vendor|supplier|customer|client|partner|lifnr|kunnr).?(id|no|num|nr|code)?$", "party_id"),
    (r"(vendor|supplier|customer|client).?name|name1", "party_name"),
    (r"quantity|qty|menge", "quantity"),
    (r"unit.?price|price", "unit_price"),
    (r"amount|net|gross|total|value|wrbtr|dmbtr|weight", "amount"),
    (r"currency|waers|curr", "currency"),
    (r"due", "due_date"),
    (r"clos|cleared|augdt", "close_date"),
    (r"post|budat|last.?changed", "posting_date"),
    (r"date|created|bldat|_on$", "document_date"),
    (r"status|state", "status"),
    (r"country|land", "country"),
    (r"cost.?cent|kostl", "cost_center"),
    (r"account|gl|hkont", "account"),
    (r"user|created.?by|usnam", "user"),
    (r"desc|text|note|remark", "description"),
    (r"(^|_)(id|no|nr|number)$|^ean$|^tax", "record_id"),
]


def demo_role(name: str) -> str:
    lowered = name.lower()
    return next((role for pattern, role in ROLE_HINTS if re.search(pattern, lowered)), "other")


def demo_plan(request: AiPlanRequest) -> dict[str, Any]:
    roles = {c.name: demo_role(c.name) for c in request.columns}
    by_role = lambda role: [name for name, r in roles.items() if r == role]  # noqa: E731
    switch_off = [
        {"test_id": t.id, "reason": "Batch numbers usually repeat across materials, so repeated values are expected here."}
        for t in request.tests
        if t.template == "uniqueness.key" and t.enabled and "batch" in t.subject.lower()
    ]
    new_rules = []
    for document in by_role("document_number")[:1]:
        for party in by_role("party_id")[:1]:
            new_rules.append({"rule": {"kind": "dependency", "from": document, "to": party},
                              "reason": f"A document number should always belong to one {party.replace('_', ' ')}; a repeated number with another party is a red flag."})
    ideas = []
    if by_role("party_id") and by_role("amount"):
        ideas.append({"idea": "Same party and same amount within a few days (possible duplicate payments)",
                      "reason": "Needs a time-window comparison; consider it as a fieldwork test."})
    return {
        "summary": (f"Demo mode: these suggestions come from fixed rules, not from an AI model. The file {request.file_name} has "
                    f"{len(request.columns)} columns; the column meanings below are guessed from their names."),
        "columns": [{"column": name, "role": role, "meaning": name.replace("_", " ").capitalize()} for name, role in roles.items()],
        "switch_off": switch_off,
        "switch_on": [],
        "new_rules": new_rules,
        "not_testable": ideas,
    }


data_quality_ai_plan_service = DataQualityAiPlanService()
