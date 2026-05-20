import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel


load_dotenv()


def resolve_projects_dir(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    cwd = Path.cwd()
    if cwd.name == "backend":
        return cwd.parent / path
    return cwd / path


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


DEFAULT_OPENAI_MODELS = ["gpt-4.1-mini", "gpt-5.4-mini", "gpt-5-mini"]


class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "local")
    deployment_mode: str = os.getenv("DEPLOYMENT_MODE", "local").lower()
    admin_secret: str = os.getenv("ADMIN_SECRET", "")
    session_secret: str = os.getenv("SESSION_SECRET", os.getenv("ADMIN_SECRET", "local-development-session-secret"))
    projects_dir: Path = resolve_projects_dir(os.getenv("PROJECTS_DIR", "./projects"))
    demo_mode: bool = os.getenv("DEMO_MODE", "false" if os.getenv("DEPLOYMENT_MODE", "local").lower() == "hosted" else "true").lower() == "true"

    llm_provider: str = os.getenv("LLM_PROVIDER", "openai")

    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_allowed_models: list[str] = parse_csv(os.getenv("OPENAI_ALLOWED_MODELS", ",".join(DEFAULT_OPENAI_MODELS)))
    openai_model: str = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODELS[0])

    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    cors_origins: list[str] = parse_csv(
        os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
        )
    )
    cors_origin_regex: str | None = os.getenv("CORS_ORIGIN_REGEX", "").strip() or None


settings = Settings()


def allowed_openai_models() -> list[str]:
    return settings.openai_allowed_models or DEFAULT_OPENAI_MODELS


def default_openai_model() -> str:
    models = allowed_openai_models()
    return settings.openai_model if settings.openai_model in models else models[0]


def validate_openai_model(model: str | None) -> str:
    selected = (model or "").strip() or default_openai_model()
    if selected not in allowed_openai_models():
        raise ValueError(f"Unsupported OpenAI model. Choose one of: {', '.join(allowed_openai_models())}.")
    return selected
