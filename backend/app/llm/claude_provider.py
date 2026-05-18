import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMProviderError, LLMResponse


class ClaudeProvider(LLMProvider):
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = True,
        temperature: float = 0.2,
    ) -> LLMResponse:
        if not settings.anthropic_api_key:
            raise LLMProviderError("ANTHROPIC_API_KEY is not configured.")
        payload = {
            "model": settings.anthropic_model,
            "max_tokens": 4000,
            "temperature": temperature,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
        headers = {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"Claude request failed: {exc}") from exc
        data = response.json()
        text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
        return LLMResponse(content=text, provider="claude", model=settings.anthropic_model, raw_response=data)
