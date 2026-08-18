import httpx

from app.config import settings
from app.llm.base import LLMProvider, LLMProviderError, LLMResponse


def response_error_detail(response: httpx.Response) -> str:
    status = f"{response.status_code} {response.reason_phrase}".strip()
    request_id = response.headers.get("x-request-id") or response.headers.get("openai-request-id")
    try:
        body = response.json()
    except ValueError:
        text = response.text.strip()
        detail = text[:1000] if text else status
    else:
        error = body.get("error") if isinstance(body, dict) else None
        if isinstance(error, dict):
            detail = str(error.get("message") or error)
            metadata = [
                f"{key}={error[key]}"
                for key in ("type", "code", "param")
                if error.get(key)
            ]
            if metadata:
                detail = f"{detail} ({', '.join(metadata)})"
        else:
            detail = str(body)[:1000]
    if request_id:
        detail = f"{detail} (request_id={request_id})"
    return f"{status}: {detail}"


def error_detail(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "request timed out after 90 seconds"
    if isinstance(exc, httpx.HTTPStatusError):
        return response_error_detail(exc.response)
    detail = str(exc).strip()
    return detail or exc.__class__.__name__


class OpenAIProvider(LLMProvider):
    async def list_models(self) -> list[str]:
        if not settings.openai_api_key:
            raise LLMProviderError("OPENAI_API_KEY is not configured.")
        headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get("https://api.openai.com/v1/models", headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"OpenAI models request failed: {error_detail(exc)}") from exc
        data = response.json()
        models = data.get("data", []) if isinstance(data, dict) else []
        return sorted(model["id"] for model in models if isinstance(model, dict) and isinstance(model.get("id"), str))

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
