"""Timestamp formatting shared by persisted models and run metadata."""
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
