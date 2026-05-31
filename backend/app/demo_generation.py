from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from collections.abc import Iterator

from app.config import default_openai_model, settings


_demo_generation_override: ContextVar[bool | None] = ContextVar("demo_generation_override", default=None)
_selected_ai_model: ContextVar[str | None] = ContextVar("selected_ai_model", default=None)


def demo_generation_enabled() -> bool:
    override = _demo_generation_override.get()
    if override is not None:
        return override
    return settings.demo_mode


def current_ai_model() -> str | None:
    if settings.llm_provider == "openai":
        return _selected_ai_model.get() or default_openai_model()
    return _selected_ai_model.get()


@contextmanager
def force_demo_generation(enabled: bool, selected_model: str | None = None) -> Iterator[None]:
    demo_token = _demo_generation_override.set(enabled)
    model_token = _selected_ai_model.set(selected_model)
    try:
        yield
    finally:
        _selected_ai_model.reset(model_token)
        _demo_generation_override.reset(demo_token)
