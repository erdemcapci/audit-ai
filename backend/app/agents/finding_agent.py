import json

from app.agents.demo_data import demo_finding
from app.agents.json_utils import parse_or_warn
from app.agents.prompts import FINDING_PROMPT, SYSTEM_PROMPT
from app.config import settings
from app.context.models import ContextPack
from app.llm.router import get_llm_provider
from app.models import AuditProject, FieldworkItem, Finding, FindingDraftRequest


class FindingAgent:
    async def run(self, audit: AuditProject, request: FindingDraftRequest, fieldwork_item: FieldworkItem | None, context_pack: ContextPack | None = None) -> Finding:
        if settings.demo_mode:
            return demo_finding(request.raw_description, fieldwork_item)
        context = json.dumps(
            {
                "audit": audit.model_dump(),
                "audit_context_pack": context_pack.rendered_context if context_pack else "",
                "context_pack_summary": context_pack.context_summary.model_dump() if context_pack else {},
                "raw_description": request.raw_description,
                "fieldwork_item": fieldwork_item.model_dump() if fieldwork_item else None,
            },
            indent=2,
        )
        response = await get_llm_provider().generate(SYSTEM_PROMPT, FINDING_PROMPT.format(finding_context=context))
        data, warning = parse_or_warn(response.content)
        if not data:
            raise ValueError(warning)
        return Finding(raw_description=request.raw_description, linked_fieldwork_item_id=request.fieldwork_item_id, **data)
