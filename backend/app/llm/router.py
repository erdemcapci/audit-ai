from app.config import settings
from app.llm.base import LLMProvider
from app.llm.claude_provider import ClaudeProvider
from app.llm.ollama_provider import OllamaProvider
from app.llm.openai_provider import OpenAIProvider


def get_llm_provider() -> LLMProvider:
    if settings.llm_provider == "openai":
        return OpenAIProvider()
    if settings.llm_provider == "claude":
        return ClaudeProvider()
    return OllamaProvider()
