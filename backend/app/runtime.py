from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import HTTPException, Request, Response

from app.config import settings
from app.models import RuntimeSettings


ADMIN_COOKIE = "auditcopilot_admin"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 12


def deployment_mode() -> str:
    return "hosted" if settings.deployment_mode == "hosted" else "local"


def llm_provider_configured() -> bool:
    if deployment_mode() == "local" and settings.demo_mode:
        return True
    if settings.llm_provider == "openai":
        return bool(settings.openai_api_key)
    if settings.llm_provider == "claude":
        return bool(settings.anthropic_api_key)
    if settings.llm_provider == "ollama":
        return bool(settings.ollama_base_url)
    return False


def _sign(payload: str) -> str:
    return hmac.new(settings.admin_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_admin_token() -> str:
    issued_at = str(int(time.time()))
    payload = f"admin:{issued_at}"
    token = f"{payload}:{_sign(payload)}"
    return base64.urlsafe_b64encode(token.encode("utf-8")).decode("utf-8")


def is_admin_request(request: Request) -> bool:
    if not settings.admin_secret:
        return False
    raw_token = request.cookies.get(ADMIN_COOKIE, "")
    if not raw_token:
        return False
    try:
        decoded = base64.urlsafe_b64decode(raw_token.encode("utf-8")).decode("utf-8")
        subject, issued_at, signature = decoded.split(":", 2)
        payload = f"{subject}:{issued_at}"
        if subject != "admin" or not hmac.compare_digest(signature, _sign(payload)):
            return False
        return time.time() - int(issued_at) <= SESSION_MAX_AGE_SECONDS
    except Exception:
        return False


def runtime_settings(request: Request) -> RuntimeSettings:
    mode = deployment_mode()
    admin_enabled = bool(settings.admin_secret)
    is_admin = is_admin_request(request)
    provider_configured = llm_provider_configured()
    if mode == "local":
        execution_enabled = provider_configured
    else:
        execution_enabled = admin_enabled and is_admin and provider_configured
    return RuntimeSettings(
        deploymentMode=mode,
        isAdmin=is_admin,
        adminEnabled=admin_enabled,
        llmProviderConfigured=provider_configured,
        agentExecutionEnabled=execution_enabled,
    )


def ensure_agent_execution_allowed(request: Request) -> None:
    runtime = runtime_settings(request)
    if runtime.agentExecutionEnabled:
        return
    if runtime.deploymentMode == "hosted" and not runtime.isAdmin:
        raise HTTPException(status_code=403, detail="AI agent execution is disabled in this hosted showcase.")
    if runtime.deploymentMode == "hosted" and not runtime.adminEnabled:
        raise HTTPException(status_code=403, detail="Admin access is not configured for hosted agent execution.")
    if not runtime.llmProviderConfigured:
        raise HTTPException(status_code=403, detail="No AI provider is configured for agent execution.")
    raise HTTPException(status_code=403, detail="AI agent execution is not available.")


def ensure_agent_log_access(request: Request, *, modify: bool = False) -> None:
    if deployment_mode() == "local":
        return
    if not is_admin_request(request):
        action = "modify agent run logging settings" if modify else "view agent run logs"
        raise HTTPException(status_code=403, detail=f"Admin login is required to {action} in hosted mode.")


def actor_id_for_request(request: Request) -> str:
    if deployment_mode() == "local":
        return "local"
    return "admin" if is_admin_request(request) else "anonymous"


def set_admin_cookie(response: Response) -> None:
    response.set_cookie(
        ADMIN_COOKIE,
        create_admin_token(),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=deployment_mode() == "hosted",
        samesite="lax",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE)
