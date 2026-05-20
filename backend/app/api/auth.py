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


def _runtime_for_user(request: Request, email: str, can_run_agents: bool):
    runtime = runtime_settings(request)
    return runtime.model_copy(
        update={
            "isAuthenticated": True,
            "userEmail": email,
            "userCanRunAgents": can_run_agents,
            "agentExecutionEnabled": runtime.llmProviderConfigured
            and (runtime.deploymentMode == "local" or runtime.isAdmin or can_run_agents),
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
    return UserMe(isAuthenticated=True, email=user.email, canRunAgents=user.can_run_agents, runtime=_runtime_for_user(request, user.email, user.can_run_agents))


@router.post("/login", response_model=UserMe)
def login(request: Request, response: Response, payload: UserAuthRequest) -> UserMe:
    email, password = _validate_credentials(payload)
    user = user_store.get_by_email(email)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    set_user_cookie(response, user.email)
    return UserMe(isAuthenticated=True, email=user.email, canRunAgents=user.can_run_agents, runtime=_runtime_for_user(request, user.email, user.can_run_agents))


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
            "agentExecutionEnabled": current_runtime.llmProviderConfigured
            and (current_runtime.deploymentMode == "local" or current_runtime.isAdmin),
        }
    )
    return UserMe(isAuthenticated=False, runtime=runtime)
