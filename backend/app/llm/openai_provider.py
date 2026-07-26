import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMProviderError, LLMResponse


def error_detail(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "request timed out after 90 seconds"
    detail = str(exc).strip()
    return detail or exc.__class__.__name__


class OpenAIProvider(LLMProvider):
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = True,
        temperature: float = 0.2,
    ) -> LLMResponse:
        if not settings.openai_api_key:
            raise LLMProviderError("OPENAI_API_KEY is not configured.")
        payload = {
            "model": settings.openai_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"OpenAI request failed: {error_detail(exc)}") from exc
        data = response.json()
        return LLMResponse(
            content=data.get("choices", [{}])[0].get("message", {}).get("content", ""),
            provider="openai",
            model=settings.openai_model,
            raw_response=data,
        )
