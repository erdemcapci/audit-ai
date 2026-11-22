"""AI interpretation of data quality results (AI #2). The AI sees the result summary of a saved run, never
the file. Its numbers are checked against the results it was given; its severities sit next to the
tests' own severities and never replace them."""
from __future__ import annotations

import json
import re
from typing import Any

from app.config import settings
from app.features.data_quality.models import (
    AI_ACTIONS,
    AI_SEVERITIES,
    AI_VERDICTS,
    AiCardInterpretation,
    AiInterpretation,
    DataQualityRun,
)
from app.features.data_quality.prompts import build_interpretation_prompts
from app.features.data_quality.store import data_quality_store
from app.llm.json_utils import parse_or_warn
from app.llm.router import get_llm_provider
from app.models import AgentState
from app.services.agent_run_log_service import agent_run_log_service
from app.store.project_store import project_store
from app.time_utils import utc_now

LOG_AGENT = AgentState(id="data_quality_ai_interpretation", type="data_quality_ai_interpretation", title="Data quality: AI interpretation", prompt="")
MAX_CARDS = 60
MAX_TEXT = 500
MAX_VALUE = 60
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2, "clean": 3}
TEMPLATE_ACTIONS = {
    "completeness.blank": "ask_client", "completeness.placeholder": "ask_client", "validity.type": "ask_client",
    "validity.pattern": "ask_client", "validity.allowed_values": "document_limitation", "validity.range": "ask_client",
    "uniqueness.key": "investigate_in_fieldwork", "uniqueness.row": "ask_client", "accuracy.outlier": "investigate_in_fieldwork",
    "accuracy.calendar": "investigate_in_fieldwork", "rule": "investigate_in_fieldwork",
}


def results_summary(run: DataQualityRun) -> dict[str, Any]:
    """What the AI is given: counts, rates and a few example values per result, plus the file's shape."""
    roles = {c.get("column"): c for c in ((run.ai_plan or {}).get("response") or {}).get("columns", [])}
    columns = []
    for column in run.profile.get("columns", []):
        entry = {"name": column.get("name"), "type": column.get("type"), "blank_percent": round(float(column.get("blankPercent", 0)), 1)}
        role = roles.get(column.get("name"))
        if role:
            entry.update({"role": role.get("role"), "meaning": role.get("meaning")})
        columns.append(entry)

    cards, clean, not_tested = [], [], []
    for test in run.results:
        if test.get("status") != "done":
            not_tested.append(f"{test.get('title')} ({'switched off' if test.get('status') == 'switched_off' else 'not applicable'})")
            continue
        passed = 0
        for card in test.get("cards", []):
            classification = card.get("classification")
            if not card.get("exceptions") and classification in (None, "holds"):
                passed += 1
                continue
            cards.append({
                "card_id": card.get("testId"),
                "test": test.get("title"),
                "template": test.get("template"),
                "subject": card.get("subject"),
                "tested": card.get("tested"),
                "exceptions": card.get("exceptions"),
                "rate_percent": round(float(card.get("rate", 0)), 2),
                "severity": card.get("severity"),
                **({"classification": classification} if classification else {}),
                "summary": card.get("summary"),
                "examples": [{"value": str(e.get("value", ""))[:MAX_VALUE], "reason": e.get("reason")} for e in card.get("examples", [])[:3]],
            })
        if passed:
            clean.append(f"{test.get('title')}: {passed} passed")
    # Findings first (by severity, then rate); rules to confirm or that did not hold come after them.
    cards.sort(key=lambda c: ("classification" in c and c["classification"] != "finding", SEVERITY_RANK.get(c["severity"], 3), -c["rate_percent"]))
    return {
        "file": {"name": run.source.name, "rows": run.source.rows, "columns": columns},
        "totals": run.totals.model_dump(),
        "code_verdict": run.verdict,
        "cards": cards[:MAX_CARDS],
        "cards_left_out": max(0, len(cards) - MAX_CARDS),
        "passed": clean,
        "not_tested": not_tested,
    }


# Numbers as written in prose: 25,020 / 0.4 / 52% / -15.00. Thousands separators are removed before comparing.
NUMBER = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.,])-?\d+(?:\.\d+)?(?![\w])")


def numbers_in(text: str) -> list[str]:
    return NUMBER.findall(text or "")


def _value(token: str) -> float:
    return float(token.replace(",", ""))


def unverified(text: str, allowed: list[float]) -> list[str]:
    """Numbers in `text` that match nothing in the results (small counts up to 10 are always fine)."""
    found = []
    for token in numbers_in(text):
        value = _value(token)
        if abs(value) <= 10 and value == int(value):
            continue
        if not any(abs(value - a) <= 0.051 or (a and abs(value - a) / abs(a) <= 0.005) for a in allowed):
            found.append(token)
    return found


def allowed_numbers(results: dict[str, Any]) -> list[float]:
    return [_value(t) for t in numbers_in(json.dumps(results, ensure_ascii=False))]


def _text(value: Any) -> str:
    return str(value or "").strip()[:MAX_TEXT]


def normalize(data: dict[str, Any], results: dict[str, Any]) -> AiInterpretation:
    sent = {c["card_id"]: c for c in results["cards"]}
    allowed = allowed_numbers(results)
    cards: list[AiCardInterpretation] = []
    for item in data.get("cards") or []:
        if not isinstance(item, dict) or item.get("card_id") not in sent or any(c.card_id == item["card_id"] for c in cards):
            continue
        card = sent[item["card_id"]]
        texts = [_text(item.get(k)) for k in ("severity_reason", "meaning", "action_text")]
        cards.append(AiCardInterpretation(
            card_id=card["card_id"],
            severity=item.get("severity") if item.get("severity") in AI_SEVERITIES else (card["severity"] if card["severity"] in AI_SEVERITIES else "low"),
            severity_reason=texts[0], meaning=texts[1],
            action=item.get("action") if item.get("action") in AI_ACTIONS else "no_action",
            action_text=texts[2],
            unverified_numbers=sorted(set(sum((unverified(t, allowed) for t in texts), []))),
        ))
    strings = lambda key, limit: [_text(v) for v in (data.get(key) or []) if isinstance(v, str) and _text(v)][:limit]  # noqa: E731
    questions, limitations, summary = strings("client_questions", 10), strings("limitations", 8), _text(data.get("summary"))
    verdict = data.get("verdict") if data.get("verdict") in AI_VERDICTS else "usable_with_conditions"
    return AiInterpretation(
        verdict=verdict, summary=summary, cards=cards, client_questions=questions, limitations=limitations,
        unverified_numbers=sorted(set(sum((unverified(t, allowed) for t in [summary, *questions, *limitations]), []))),
    )


def has_unverified(result: AiInterpretation) -> list[str]:
    return sorted(set(result.unverified_numbers + [n for c in result.cards for n in c.unverified_numbers]))


class DataQualityInterpretationService:
    async def interpret(self, project_id: str, run_id: str, actor_id: str) -> DataQualityRun:
        run = data_quality_store.get_run(project_id, run_id)
        audit = project_store.get_project(project_id)
        planning = project_store.load_planning(project_id)
        results = results_summary(run)
        system_prompt, user_prompt = build_interpretation_prompts(results, audit, planning)
        demo = settings.demo_mode
        provider_name = "demo" if demo else settings.llm_provider
        model_name = "deterministic-demo" if demo else ""
        log_id = agent_run_log_service.start_run(
            project_id=project_id, actor_id=actor_id, agent=LOG_AGENT, provider=provider_name, model=model_name,
            selected_item_ids=[run_id], context_recipe_id="data_quality_interpretation",
            context_blocks_used=["audit", "file", "results"], estimated_context_tokens=(len(system_prompt) + len(user_prompt)) // 4,
            context_truncated=results["cards_left_out"] > 0, rendered_context=user_prompt,
        )
        raw: Any = None
        attempts = 1
        try:
            if demo:
                result = normalize(demo_interpretation(results), results)
            else:
                result, provider_name, model_name, raw = await self._ask(system_prompt, user_prompt, results)
                wrong = has_unverified(result)
                if wrong:
                    # One retry, telling the model which numbers are not in the results.
                    attempts = 2
                    correction = f"Your previous answer used numbers that are not in the results: {', '.join(wrong)}. Use only numbers from the results."
                    system_prompt, user_prompt = build_interpretation_prompts(results, audit, planning, correction)
                    result, provider_name, model_name, raw = await self._ask(system_prompt, user_prompt, results)
        except Exception as exc:
            agent_run_log_service.fail_run(project_id, log_id, error_message=str(exc), provider=provider_name, model=model_name,
                                           final_prompt={"system": system_prompt, "user": user_prompt}, raw_llm_response=raw)
            raise
        result = result.model_copy(update={
            "provider": provider_name, "model": model_name, "demo": demo, "log_run_id": log_id, "attempts": attempts,
            "estimated_tokens": (len(system_prompt) + len(user_prompt)) // 4, "cards_sent": len(results["cards"]), "created_at": utc_now(),
        })
        agent_run_log_service.complete_run(project_id, log_id, provider=provider_name, model=model_name, output_object_ids=[run_id],
                                           final_prompt={"system": system_prompt, "user": user_prompt},
                                           parsed_output=result.model_dump(), raw_llm_response=raw)
        updated = run.model_copy(update={"ai_interpretation": result.model_dump(), "ai_verdict": result.verdict, "ai_used": True})
        return data_quality_store.save_run(project_id, updated)

    async def _ask(self, system_prompt: str, user_prompt: str, results: dict[str, Any]) -> tuple[AiInterpretation, str, str, Any]:
        response = await get_llm_provider().generate(system_prompt, user_prompt, json_mode=True)
        data, warning = parse_or_warn(response.content)
        if data is None:
            raise ValueError(warning)
        return normalize(data, results), response.provider, response.model, response.raw_response


# Demo mode: fixed sentences built only from the results, so every number is verifiable.
ACTION_TEXT = {
    "ask_client": "Ask the data owner to explain or correct these records before relying on the column.",
    "exclude_records": "Exclude these records from samples and analyses, and record why.",
    "document_limitation": "Record this as a limitation of the data; it does not stop the planned tests.",
    "investigate_in_fieldwork": "Select these records for follow-up in fieldwork.",
    "no_action": "No action needed.",
}


def demo_interpretation(results: dict[str, Any]) -> dict[str, Any]:
    cards, questions = [], []
    for card in results["cards"]:
        uncertain = card.get("classification") in ("uncertain", "rule_did_not_hold")
        action = "ask_client" if uncertain else TEMPLATE_ACTIONS.get(card["template"], "ask_client")
        severity = card["severity"] if card["severity"] in AI_SEVERITIES else "low"
        cards.append({
            "card_id": card["card_id"], "severity": severity,
            "severity_reason": f"{card['test']} on “{card['subject']}” affects {card['exceptions']} of {card['tested']} records ({card['rate_percent']}%).",
            "meaning": ("The assumed rule may not apply to this file; " if uncertain else "") + str(card["summary"]),
            "action": action, "action_text": ACTION_TEXT[action],
        })
        if action == "ask_client" and len(questions) < 5:
            questions.append(f"Can you explain the {card['exceptions']} records flagged by “{card['test']}” in “{card['subject']}”?")
    high = any(c["severity"] == "high" and not c.get("classification") for c in results["cards"])
    verdict = "usable" if not results["cards"] else "usable_with_conditions"
    return {
        "verdict": verdict,
        "summary": ("Demo mode: this interpretation comes from fixed rules, not from an AI model. "
                    + ("There are high-severity findings to resolve before relying on the affected columns." if high
                       else "The findings are limited; record them and continue." if results["cards"] else "No test found exceptions.")),
        "cards": cards,
        "client_questions": questions,
        "limitations": [f"{name} could not be tested." for name in results["not_tested"][:3]],
    }


data_quality_interpretation_service = DataQualityInterpretationService()
