from __future__ import annotations

import base64
import hashlib
import hmac
import time
from uuid import uuid4

from fastapi import HTTPException, Request, Response

from app.config import settings
from app.demo_generation import demo_generation_enabled, force_demo_generation
from app.models import RuntimeSettings
from app.store.user_store import user_store


ADMIN_COOKIE = "auditcopilot_admin"
USER_COOKIE = "auditcopilot_user"
ANONYMOUS_SESSION_COOKIE = "auditcopilot_anon"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 12
ANONYMOUS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14


def deployment_mode() -> str:
    return "hosted" if settings.deployment_mode == "hosted" else "local"


def llm_provider_configured() -> bool:
    if settings.demo_mode:
        return True
    return real_llm_provider_configured()


def real_llm_provider_configured() -> bool:
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


def create_anonymous_session_token(session_id: str | None = None) -> str:
    actual_session_id = session_id or f"anon_{uuid4().hex[:24]}"
    payload = f"anon:{actual_session_id}"
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


def anonymous_session_id(request: Request) -> str | None:
    raw_token = request.cookies.get(ANONYMOUS_SESSION_COOKIE, "")
    if not raw_token:
        return None
    try:
        decoded = base64.urlsafe_b64decode(raw_token.encode("utf-8")).decode("utf-8")
        subject, session_id, signature = decoded.split(":", 2)
        payload = f"{subject}:{session_id}"
        if subject != "anon" or not hmac.compare_digest(signature, _sign(payload)):
            return None
        return session_id
    except Exception:
        return None


def ensure_anonymous_session(request: Request, response: Response) -> str:
    existing = anonymous_session_id(request)
    if existing:
        return existing
    session_id = f"anon_{uuid4().hex[:24]}"
    set_anonymous_session_cookie(response, session_id)
    return session_id


def runtime_settings(request: Request) -> RuntimeSettings:
    mode = deployment_mode()
    admin_enabled = bool(settings.admin_secret)
    is_admin = is_admin_request(request)
    user = current_user(request)
    user_run_limit = user.ai_total_run_limit if user else None
    user_runs_used = user.ai_runs_used if user else 0
    user_runs_remaining = max(0, user.ai_total_run_limit - user.ai_runs_used) if user else None
    user_can_run_agents = bool(user and user.can_run_agents and user_runs_remaining and user_runs_remaining > 0)
    real_provider_configured = real_llm_provider_configured()
    hosted_demo_available = bool(mode == "hosted" and settings.showcase_demo_agents_enabled and user)
    provider_configured = llm_provider_configured() or hosted_demo_available
    if mode == "local":
        execution_enabled = provider_configured
    elif is_admin:
        execution_enabled = provider_configured and admin_enabled
    elif user:
        execution_enabled = hosted_demo_available or (real_provider_configured and user_can_run_agents)
    else:
        execution_enabled = False
    if mode == "hosted" and not user and not is_admin:
        access_message = "You can explore demo data. Sign in to run demo generation; real AI requires approved access."
    elif mode == "hosted" and user and not user.can_run_agents and hosted_demo_available:
        access_message = "Demo generation is enabled. Real AI access is limited and requires approval from the project owner."
    elif mode == "hosted" and user and not user.can_run_agents:
        access_message = "AI access is not enabled for your account yet. Please contact the project owner to request access."
    elif mode == "hosted" and user and user.ai_runs_used >= user.ai_total_run_limit and hosted_demo_available:
        access_message = "Demo generation is enabled. Your real AI usage limit has been reached."
    elif mode == "hosted" and user and user.ai_runs_used >= user.ai_total_run_limit:
        access_message = "Your AI usage limit has been reached."
    elif mode == "hosted" and user and user.can_run_agents:
        if settings.demo_mode:
            access_message = "Demo generation is enabled. Real AI runs are available only when the hosted demo is switched out of demo mode."
        elif real_provider_configured:
            access_message = f"{user_runs_remaining} AI run{'s' if user_runs_remaining != 1 else ''} remaining."
        else:
            access_message = "Demo generation is enabled because no real AI provider is configured."
    elif not provider_configured:
        access_message = "No AI provider is configured."
    else:
        access_message = ""
    return RuntimeSettings(
        deploymentMode=mode,
        isAdmin=is_admin,
        isAuthenticated=bool(user),
        userEmail=user.email if user else None,
        userCanRunAgents=user_can_run_agents,
        userAiRunLimit=user_run_limit,
        userAiRunsUsed=user_runs_used,
        userAiRunsRemaining=user_runs_remaining,
        aiAccessMessage=access_message,
        adminEnabled=admin_enabled,
        llmProviderConfigured=provider_configured,
        agentExecutionEnabled=execution_enabled,
    )


def ensure_agent_execution_allowed(request: Request) -> None:
    runtime = runtime_settings(request)
    if runtime.agentExecutionEnabled:
        return
    if runtime.deploymentMode == "hosted" and runtime.aiAccessMessage:
        raise HTTPException(status_code=403, detail=runtime.aiAccessMessage)
    if runtime.deploymentMode == "hosted" and runtime.isAdmin and not runtime.adminEnabled:
        raise HTTPException(status_code=403, detail="Admin access is not configured for hosted agent execution.")
    if not runtime.llmProviderConfigured:
        raise HTTPException(status_code=403, detail="No AI provider is configured for agent execution.")
    raise HTTPException(status_code=403, detail="AI agent execution is not available.")


def should_use_demo_generation(request: Request) -> bool:
    if deployment_mode() != "hosted":
        return settings.demo_mode
    if settings.demo_mode:
        return True
    if is_admin_request(request):
        return False
    if not settings.showcase_demo_agents_enabled:
        return False
    user = current_user(request)
    if not user:
        return False
    real_access_available = bool(
        user.can_run_agents
        and user.ai_runs_used < user.ai_total_run_limit
        and real_llm_provider_configured()
    )
    return not real_access_available


def agent_execution_context(request: Request):
    ensure_agent_execution_allowed(request)
    return force_demo_generation(should_use_demo_generation(request))


def record_successful_ai_run(request: Request) -> None:
    if deployment_mode() != "hosted" or is_admin_request(request):
        return
    if demo_generation_enabled():
        return
    user = current_user(request)
    if not user:
        return
    try:
        user_store.record_ai_run(user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


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


def set_anonymous_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        ANONYMOUS_SESSION_COOKIE,
        create_anonymous_session_token(session_id),
        max_age=ANONYMOUS_SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=deployment_mode() == "hosted",
        samesite="lax",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE)


def clear_user_cookie(response: Response) -> None:
    response.delete_cookie(USER_COOKIE)
