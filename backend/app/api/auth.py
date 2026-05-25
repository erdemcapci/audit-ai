from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request, Response

from app.models import UserAuthRequest, UserMe
from app.runtime import clear_user_cookie, current_user, runtime_settings, set_user_cookie
from app.store.user_store import user_store, verify_password


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _validate_credentials(payload: UserAuthRequest) -> tuple[str, str]:
    email = payload.email.strip().lower()
    password = payload.password
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    return email, password


def _me_response(request: Request) -> UserMe:
    user = current_user(request)
    return UserMe(
        isAuthenticated=bool(user),
        email=user.email if user else None,
        canRunAgents=bool(user and user.can_run_agents),
        runtime=runtime_settings(request),
    )


def _runtime_for_user(request: Request, email: str, can_run_agents: bool, ai_total_run_limit: int, ai_runs_used: int):
    runtime = runtime_settings(request)
    remaining = max(0, ai_total_run_limit - ai_runs_used)
    enabled = can_run_agents and remaining > 0
    if runtime.deploymentMode == "hosted" and not can_run_agents:
        access_message = "AI access is not enabled for your account yet. Please contact the project owner to request access."
    elif runtime.deploymentMode == "hosted" and remaining <= 0:
        access_message = "Your AI usage limit has been reached."
    elif runtime.deploymentMode == "hosted":
        access_message = f"{remaining} AI run{'s' if remaining != 1 else ''} remaining."
    else:
        access_message = runtime.aiAccessMessage
    return runtime.model_copy(
        update={
            "isAuthenticated": True,
            "userEmail": email,
            "userCanRunAgents": enabled,
            "userAiRunLimit": ai_total_run_limit,
            "userAiRunsUsed": ai_runs_used,
            "userAiRunsRemaining": remaining,
            "aiAccessMessage": access_message,
            "agentExecutionEnabled": runtime.llmProviderConfigured
            and (runtime.deploymentMode == "local" or runtime.isAdmin or enabled),
        }
    )


@router.post("/signup", response_model=UserMe)
def signup(request: Request, response: Response, payload: UserAuthRequest) -> UserMe:
    email, password = _validate_credentials(payload)
    try:
        user = user_store.create_user(email, password)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    set_user_cookie(response, user.email)
    return UserMe(
        isAuthenticated=True,
        email=user.email,
        canRunAgents=user.can_run_agents,
        runtime=_runtime_for_user(request, user.email, user.can_run_agents, user.ai_total_run_limit, user.ai_runs_used),
    )


@router.post("/login", response_model=UserMe)
def login(request: Request, response: Response, payload: UserAuthRequest) -> UserMe:
    email, password = _validate_credentials(payload)
    user = user_store.get_by_email(email)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    set_user_cookie(response, user.email)
    return UserMe(
        isAuthenticated=True,
        email=user.email,
        canRunAgents=user.can_run_agents,
        runtime=_runtime_for_user(request, user.email, user.can_run_agents, user.ai_total_run_limit, user.ai_runs_used),
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
            "aiAccessMessage": "You can explore demo data, but AI generation requires approved access."
            if current_runtime.deploymentMode == "hosted"
            else current_runtime.aiAccessMessage,
            "agentExecutionEnabled": current_runtime.llmProviderConfigured
            and (current_runtime.deploymentMode == "local" or current_runtime.isAdmin),
        }
    )
    return UserMe(isAuthenticated=False, runtime=runtime)
