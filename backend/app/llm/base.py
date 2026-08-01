from pydantic import BaseModel


class LLMResponse(BaseModel):
    content: str
    provider: str
    model: str
    raw_response: dict | list | str | None = None
    json_valid: bool = False
    warning: str = ""


class LLMProviderError(RuntimeError):
    pass


class LLMProvider:
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = True,
        temperature: float = 0.2,
    ) -> LLMResponse:
        raise NotImplementedError
