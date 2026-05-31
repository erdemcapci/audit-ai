from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from collections.abc import Iterator

from app.config import settings


_force_demo_generation: ContextVar[bool] = ContextVar("force_demo_generation", default=False)


def demo_generation_enabled() -> bool:
    return settings.demo_mode or _force_demo_generation.get()


@contextmanager
def force_demo_generation(enabled: bool) -> Iterator[None]:
    token = _force_demo_generation.set(enabled)
    try:
        yield
    finally:
        _force_demo_generation.reset(token)
