from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.config import settings
from app.runtime import deployment_mode


_attempts: dict[str, deque[float]] = defaultdict(deque)


def client_key(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_hosted_rate_limit(request: Request, bucket: str, limit: int | None = None, window_seconds: int | None = None) -> None:
    if deployment_mode() != "hosted":
        return
    actual_limit = max(1, limit or settings.auth_rate_limit_attempts)
    actual_window = max(1, window_seconds or settings.rate_limit_window_seconds)
    now = time.time()
    key = f"{bucket}:{client_key(request)}"
    attempts = _attempts[key]
    while attempts and now - attempts[0] > actual_window:
        attempts.popleft()
    if len(attempts) >= actual_limit:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    attempts.append(now)
