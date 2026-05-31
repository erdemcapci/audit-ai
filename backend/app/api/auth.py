from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request, Response

from app.config import settings
from app.models import UserAuthRequest, UserMe
from app.runtime import clear_user_cookie, current_user, model_label, provider_label, real_llm_provider_configured, runtime_settings, set_user_cookie
from app.showcase.rate_limit import enforce_hosted_rate_limit
from app.store.user_store import user_store, verify_password


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _validate_username(username: str) -> str:
    normalized = username.strip().lower()
    if not re.match(r"^[a-z0-9][a-z0-9_-]{2,31}$", normalized):
        raise HTTPException(status_code=400, detail="Use 3-32 characters: letters, numbers, underscore, or hyphen.")
    return normalized


def _me_response(request: Request) -> UserMe:
    user = current_user(request)
    return UserMe(
        isAuthenticated=bool(user),
        username=user.email if user else None,
        canRunAgents=bool(user and user.can_run_agents),
        runtime=runtime_settings(request),
    )


def _runtime_for_user(request: Request, username: str, can_run_agents: bool, ai_total_run_limit: int, ai_runs_used: int, ai_model: str | None):
    runtime = runtime_settings(request)
    remaining = max(0, ai_total_run_limit - ai_runs_used)
    enabled = can_run_agents and remaining > 0
    real_enabled = bool(enabled and real_llm_provider_configured())
    demo_enabled = bool(runtime.deploymentMode == "hosted" and settings.showcase_demo_agents_enabled)
    if runtime.deploymentMode == "hosted" and not can_run_agents and demo_enabled:
        access_message = "Demo generation is enabled. Real AI access is limited and requires approval from the project owner."
    elif runtime.deploymentMode == "hosted" and not can_run_agents:
        access_message = "AI access is not enabled for your account yet. Please contact the project owner to request access."
    elif runtime.deploymentMode == "hosted" and remaining <= 0 and demo_enabled:
        access_message = "Demo generation is enabled. Your real AI usage limit has been reached."
    elif runtime.deploymentMode == "hosted" and remaining <= 0:
        access_message = "Your AI usage limit has been reached."
    elif runtime.deploymentMode == "hosted":
        access_message = f"{remaining} AI run{'s' if remaining != 1 else ''} remaining." if real_enabled else "Demo generation is enabled because no real AI provider is configured."
    else:
        access_message = runtime.aiAccessMessage
    active_provider_label = provider_label() if real_enabled else "Demo Data"
    active_model_label = model_label(ai_model) if real_enabled else "Demo Model"
    return runtime.model_copy(
        update={
            "isAuthenticated": True,
            "userEmail": username,
            "userCanRunAgents": enabled,
            "userAiRunLimit": ai_total_run_limit,
            "userAiRunsUsed": ai_runs_used,
            "userAiRunsRemaining": remaining,
            "aiAccessMessage": access_message,
            "agentExecutionEnabled": runtime.llmProviderConfigured
            and (runtime.deploymentMode == "local" or runtime.isAdmin or enabled or demo_enabled),
            "activeAiProviderLabel": active_provider_label,
            "activeAiModelLabel": active_model_label,
        }
    )


@router.post("/signup", response_model=UserMe)
def signup(request: Request, response: Response, payload: UserAuthRequest) -> UserMe:
    enforce_hosted_rate_limit(request, "auth-signup", settings.auth_rate_limit_attempts)
    username = _validate_username(payload.username)
    try:
        user, access_code = user_store.create_user(username)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    set_user_cookie(response, user.email)
    return UserMe(
        isAuthenticated=True,
        username=user.email,
        accessCode=access_code,
        canRunAgents=user.can_run_agents,
        runtime=_runtime_for_user(request, user.email, user.can_run_agents, user.ai_total_run_limit, user.ai_runs_used, user.ai_model),
    )


@router.post("/login", response_model=UserMe)
def login(request: Request, response: Response, payload: UserAuthRequest) -> UserMe:
    enforce_hosted_rate_limit(request, "auth-login", settings.auth_rate_limit_attempts)
    username = _validate_username(payload.username)
    access_code = payload.access_code.strip().upper()
    user = user_store.get_by_username(username)
    if not user or not verify_password(access_code, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or access code.")
    set_user_cookie(response, user.email)
    return UserMe(
        isAuthenticated=True,
        username=user.email,
        canRunAgents=user.can_run_agents,
        runtime=_runtime_for_user(request, user.email, user.can_run_agents, user.ai_total_run_limit, user.ai_runs_used, user.ai_model),
    )


@router.get("/me", response_model=UserMe)
def me(request: Request) -> UserMe:
    return _me_response(request)


@router.post("/logout", response_model=UserMe)
def logout(request: Request, response: Response) -> UserMe:
    clear_user_cookie(response)
    current_runtime = runtime_settings(request)
    runtime = current_runtime.model_copy(
        update={
            "isAuthenticated": False,
            "userEmail": None,
            "userCanRunAgents": False,
            "userAiRunLimit": None,
            "userAiRunsUsed": 0,
            "userAiRunsRemaining": None,
            "aiAccessMessage": "Demo generation is enabled. Sign in only if you want to save private demo audits."
            if current_runtime.deploymentMode == "hosted"
            else current_runtime.aiAccessMessage,
            "agentExecutionEnabled": current_runtime.llmProviderConfigured
            and (current_runtime.deploymentMode == "local" or current_runtime.isAdmin or settings.showcase_demo_agents_enabled),
            "activeAiProviderLabel": "Demo Data" if current_runtime.deploymentMode == "hosted" else current_runtime.activeAiProviderLabel,
            "activeAiModelLabel": "Demo Model" if current_runtime.deploymentMode == "hosted" else current_runtime.activeAiModelLabel,
        }
    )
    return UserMe(isAuthenticated=False, runtime=runtime)
