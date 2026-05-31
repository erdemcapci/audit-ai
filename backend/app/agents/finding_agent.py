import json

from app.agents.demo_data import demo_finding
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import FINDING_PROMPT, SYSTEM_PROMPT
from app.demo_generation import current_ai_model, demo_generation_enabled
from app.llm.router import get_llm_provider
from app.models import AuditProject, FieldworkItem, Finding, FindingDraftRequest


class FindingAgent:
    async def run(
        self,
        audit: AuditProject,
        request: FindingDraftRequest,
        fieldwork_item: FieldworkItem | None,
        model: str | None = None,
    ) -> Finding:
        if demo_generation_enabled():
            return demo_finding(request.raw_description, fieldwork_item)
        context = json.dumps(
            {
                "audit": audit.model_dump(),
                "raw_description": request.raw_description,
                "fieldwork_item": fieldwork_item.model_dump() if fieldwork_item else None,
            },
            indent=2,
        )
        response = await get_llm_provider().generate(SYSTEM_PROMPT, FINDING_PROMPT.format(finding_context=context), model=model or current_ai_model())
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        return Finding(raw_description=request.raw_description, linked_fieldwork_item_id=request.fieldwork_item_id, **data)
