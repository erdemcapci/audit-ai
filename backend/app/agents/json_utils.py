import json
import re
from typing import Any


def extract_json_object(text: str) -> str | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    if cleaned.startswith("{") and cleaned.endswith("}"):
        return cleaned
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        return cleaned[start : end + 1]
    return None


def parse_or_warn(text: str) -> tuple[dict[str, Any] | None, str]:
    json_text = extract_json_object(text)
    if not json_text:
        return None, "Model response did not include a JSON object."
    try:
        return json.loads(json_text), ""
    except json.JSONDecodeError as exc:
        return None, f"Model returned invalid JSON: {exc}"
