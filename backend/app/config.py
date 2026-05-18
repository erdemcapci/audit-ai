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


class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "local")
    projects_dir: Path = resolve_projects_dir(os.getenv("PROJECTS_DIR", "./projects"))
    demo_mode: bool = os.getenv("DEMO_MODE", "true").lower() == "true"

    llm_provider: str = os.getenv("LLM_PROVIDER", "ollama")

    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


settings = Settings()
