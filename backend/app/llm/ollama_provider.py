import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMProviderError, LLMResponse


class OllamaProvider(LLMProvider):
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = True,
        temperature: float = 0.2,
    ) -> LLMResponse:
        payload = {
            "model": settings.ollama_model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "options": {"temperature": temperature},
        }
        if json_mode:
            payload["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"Ollama request failed: {exc}") from exc
        data = response.json()
        return LLMResponse(
            content=data.get("message", {}).get("content", ""),
            provider="ollama",
            model=settings.ollama_model,
            raw_response=data,
        )
