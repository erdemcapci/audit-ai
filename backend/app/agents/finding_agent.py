import json

from app.agents.demo_data import demo_finding
from app.agents.context_utils import compact_audit
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import FINDING_PROMPT, SYSTEM_PROMPT
from app.context.models import ContextPack
from app.demo_generation import current_ai_model, demo_generation_enabled
from app.llm.router import get_llm_provider
from app.models import AuditProject, FieldworkItem, Finding, FindingDraftRequest


class FindingAgent:
    async def run(
        self,
        audit: AuditProject,
        request: FindingDraftRequest,
        fieldwork_item: FieldworkItem | None,
        context_pack: ContextPack | None = None,
        capture: dict | None = None,
    ) -> Finding:
        if demo_generation_enabled():
            return demo_finding(request.raw_description, fieldwork_item)
        task_parameters = {
            "raw_description": request.raw_description,
            "fieldwork_item": {
                "id": fieldwork_item.id,
                "type": "fieldwork_item",
                "title": fieldwork_item.title,
                "status": fieldwork_item.status,
            }
            if fieldwork_item
            else None,
        }
        context = "\n".join(
            [
                context_pack.rendered_context
                if context_pack
                else "# Audit Context Pack\n\n## Global Audit Knowledge\n\n```json\n"
                + json.dumps({"audit": compact_audit(audit)}, indent=2)
                + "\n```",
                "",
                "## Task Instruction",
                "",
                "Draft a structured internal audit finding from the rough description.",
                "",
                "## Task Parameters",
                "",
                "```json",
                json.dumps(task_parameters, indent=2),
                "```",
            ]
        )
        user_prompt = FINDING_PROMPT.format(finding_context=context)
        response = await get_llm_provider().generate(SYSTEM_PROMPT, user_prompt, model=current_ai_model())
        if capture is not None:
            capture["provider"] = response.provider
            capture["model"] = response.model
            capture.setdefault("exchanges", []).append({"system_prompt": SYSTEM_PROMPT, "user_prompt": user_prompt})
            capture.setdefault("raw_responses", []).append(response.raw_response)
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        return Finding(raw_description=request.raw_description, linked_fieldwork_item_id=request.fieldwork_item_id, **data)
