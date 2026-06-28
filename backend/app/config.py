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


def parse_bool(value: str, default: bool = False) -> bool:
    if not value:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "local")
    deployment_mode: str = os.getenv("DEPLOYMENT_MODE", "local").lower()
    admin_secret: str = os.getenv("ADMIN_SECRET", "")
    projects_dir: Path = resolve_projects_dir(os.getenv("PROJECTS_DIR", "./projects"))
    demo_mode: bool = os.getenv("DEMO_MODE", "true").lower() == "true"

    llm_provider: str = os.getenv("LLM_PROVIDER", "ollama")

    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    agent_run_logs_enabled: bool = parse_bool(os.getenv("AGENT_RUN_LOGS_ENABLED", "true"), True)
    agent_run_log_full_io: bool = parse_bool(os.getenv("AGENT_RUN_LOG_FULL_IO", "false"))
    agent_run_log_raw_response: bool = parse_bool(os.getenv("AGENT_RUN_LOG_RAW_RESPONSE", "false"))
    agent_run_log_retention_days: int = max(1, int(os.getenv("AGENT_RUN_LOG_RETENTION_DAYS", "30")))
    agent_run_log_dir: str = os.getenv("AGENT_RUN_LOG_DIR", "agent_runs").strip() or "agent_runs"
    allow_hosted_full_agent_logs: bool = parse_bool(os.getenv("ALLOW_HOSTED_FULL_AGENT_LOGS", "false"))

    cors_origins: list[str] = parse_csv(
        os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
        )
    )
    cors_origin_regex: str | None = os.getenv("CORS_ORIGIN_REGEX", "").strip() or None


settings = Settings()
