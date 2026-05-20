from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import HTTPException, Request, Response

from app.config import settings
from app.models import RuntimeSettings
from app.store.user_store import user_store


ADMIN_COOKIE = "auditcopilot_admin"
USER_COOKIE = "auditcopilot_user"
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
    secret = settings.session_secret or settings.admin_secret or "local-development-session-secret"
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_admin_token() -> str:
    issued_at = str(int(time.time()))
    payload = f"admin:{issued_at}"
    token = f"{payload}:{_sign(payload)}"
    return base64.urlsafe_b64encode(token.encode("utf-8")).decode("utf-8")


def create_user_token(email: str) -> str:
    issued_at = str(int(time.time()))
    payload = f"user:{email}:{issued_at}"
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


def current_user(request: Request):
    raw_token = request.cookies.get(USER_COOKIE, "")
    if not raw_token:
        return None
    try:
        decoded = base64.urlsafe_b64decode(raw_token.encode("utf-8")).decode("utf-8")
        subject, email, issued_at, signature = decoded.split(":", 3)
        payload = f"{subject}:{email}:{issued_at}"
        if subject != "user" or not hmac.compare_digest(signature, _sign(payload)):
            return None
        if time.time() - int(issued_at) > SESSION_MAX_AGE_SECONDS:
            return None
        return user_store.get_by_email(email)
    except Exception:
        return None


def runtime_settings(request: Request) -> RuntimeSettings:
    mode = deployment_mode()
    admin_enabled = bool(settings.admin_secret)
    is_admin = is_admin_request(request)
    user = current_user(request)
    user_can_run_agents = bool(user and user.can_run_agents)
    provider_configured = llm_provider_configured()
    if mode == "local":
        execution_enabled = provider_configured
    else:
        execution_enabled = provider_configured and ((admin_enabled and is_admin) or user_can_run_agents)
    return RuntimeSettings(
        deploymentMode=mode,
        isAdmin=is_admin,
        isAuthenticated=bool(user),
        userEmail=user.email if user else None,
        userCanRunAgents=user_can_run_agents,
        adminEnabled=admin_enabled,
        llmProviderConfigured=provider_configured,
        agentExecutionEnabled=execution_enabled,
    )


def ensure_agent_execution_allowed(request: Request) -> None:
    runtime = runtime_settings(request)
    if runtime.agentExecutionEnabled:
        return
    if runtime.deploymentMode == "hosted" and not runtime.isAdmin and not runtime.isAuthenticated:
        raise HTTPException(status_code=403, detail="Sign in is required for hosted AI agent execution.")
    if runtime.deploymentMode == "hosted" and runtime.isAuthenticated and not runtime.userCanRunAgents:
        raise HTTPException(status_code=403, detail="Your account does not have AI agent access yet.")
    if runtime.deploymentMode == "hosted" and not runtime.adminEnabled:
        raise HTTPException(status_code=403, detail="Admin access is not configured for hosted agent execution.")
    if not runtime.llmProviderConfigured:
        raise HTTPException(status_code=403, detail="No AI provider is configured for agent execution.")
    raise HTTPException(status_code=403, detail="AI agent execution is not available.")


def set_admin_cookie(response: Response) -> None:
    response.set_cookie(
        ADMIN_COOKIE,
        create_admin_token(),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=deployment_mode() == "hosted",
        samesite="lax",
    )


def set_user_cookie(response: Response, email: str) -> None:
    response.set_cookie(
        USER_COOKIE,
        create_user_token(email),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=deployment_mode() == "hosted",
        samesite="lax",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE)


def clear_user_cookie(response: Response) -> None:
    response.delete_cookie(USER_COOKIE)
