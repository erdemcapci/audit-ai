import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMProviderError, LLMResponse


def error_detail(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "request timed out after 90 seconds"
    detail = str(exc).strip()
    return detail or exc.__class__.__name__


class OllamaProvider(LLMProvider):
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = True,
    ) -> LLMResponse:
        payload = {
            "model": settings.ollama_model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if json_mode:
            payload["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"Ollama request failed: {error_detail(exc)}") from exc
        data = response.json()
        return LLMResponse(
            content=data.get("message", {}).get("content", ""),
            provider="ollama",
            model=settings.ollama_model,
            raw_response=data,
        )
