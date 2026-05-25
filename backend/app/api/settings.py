from fastapi import APIRouter, HTTPException, Request

from app.config import default_openai_model, settings, validate_openai_model
from app.llm.base import LLMProviderError
from app.llm.router import get_llm_provider
from app.models import LLMSettings, LLMSettingsUpdate, RuntimeSettings
from app.runtime import deployment_mode, ensure_agent_execution_allowed, is_admin_request, record_successful_ai_run, runtime_settings


router = APIRouter(prefix="/api/settings/llm", tags=["settings"])
runtime_router = APIRouter(prefix="/api/settings", tags=["settings"])


def current_settings() -> LLMSettings:
    model = settings.ollama_model
    if settings.llm_provider == "openai":
        model = default_openai_model()
    elif settings.llm_provider == "claude":
        model = settings.anthropic_model
    return LLMSettings(
        provider=settings.llm_provider,
        model=model,
        demo_mode=settings.demo_mode,
        ollama_base_url=settings.ollama_base_url,
        openai_configured=bool(settings.openai_api_key),
        anthropic_configured=bool(settings.anthropic_api_key),
    )


@router.get("", response_model=LLMSettings)
def get_llm_settings() -> LLMSettings:
    return current_settings()


@router.put("", response_model=LLMSettings)
def update_llm_settings(request: Request, update: LLMSettingsUpdate) -> LLMSettings:
    if deployment_mode() == "hosted" and not is_admin_request(request):
        raise HTTPException(status_code=403, detail="Admin login is required to change hosted LLM settings.")
    settings.llm_provider = update.provider
    if update.demo_mode is not None:
        settings.demo_mode = update.demo_mode
    if update.model:
        if update.provider == "openai":
            settings.openai_model = validate_openai_model(update.model)
        elif update.provider == "claude":
            settings.anthropic_model = update.model
        else:
            settings.ollama_model = update.model
    if update.openai_api_key is not None:
        settings.openai_api_key = update.openai_api_key.strip()
    if update.anthropic_api_key is not None:
        settings.anthropic_api_key = update.anthropic_api_key.strip()
    return current_settings()


@runtime_router.get("/runtime", response_model=RuntimeSettings)
def get_runtime_settings(request: Request) -> RuntimeSettings:
    return runtime_settings(request)


@router.post("/test")
async def test_llm_settings(request: Request) -> dict[str, str | bool]:
    ensure_agent_execution_allowed(request)
    if settings.demo_mode:
        return {"ok": True, "message": "Demo mode is enabled. No provider call required."}
    try:
        response = await get_llm_provider().generate("Return JSON only.", '{"status":"ok"}', json_mode=True)
    except LLMProviderError as exc:
        return {"ok": False, "message": str(exc)}
    record_successful_ai_run(request)
    return {"ok": True, "message": f"Connected to {response.provider} using {response.model}."}
