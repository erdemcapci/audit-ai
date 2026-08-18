from __future__ import annotations

import sys
import unittest
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.llm import openai_provider
from app.llm.base import LLMProviderError
from app.llm.openai_provider import OpenAIProvider


class FakeAsyncClient:
    response: httpx.Response | None = None
    last_post_payload: dict | None = None

    def __init__(self, timeout: int):
        self.timeout = timeout

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, _: str, json: dict, headers: dict) -> httpx.Response:
        FakeAsyncClient.last_post_payload = json
        assert headers["Authorization"] == f"Bearer {settings.openai_api_key}"
        assert self.response is not None
        return self.response

    async def get(self, _: str, headers: dict) -> httpx.Response:
        assert headers["Authorization"] == f"Bearer {settings.openai_api_key}"
        assert self.response is not None
        return self.response


class OpenAIProviderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.original = {
            "openai_api_key": settings.openai_api_key,
            "openai_model": settings.openai_model,
        }
        self.original_client = openai_provider.httpx.AsyncClient
        settings.openai_api_key = "sk-test"
        settings.openai_model = "gpt-test"
        openai_provider.httpx.AsyncClient = FakeAsyncClient

    def tearDown(self) -> None:
        for key, value in self.original.items():
            setattr(settings, key, value)
        openai_provider.httpx.AsyncClient = self.original_client
        FakeAsyncClient.response = None
        FakeAsyncClient.last_post_payload = None

    async def test_http_status_error_surfaces_openai_error_body(self) -> None:
        FakeAsyncClient.response = httpx.Response(
            400,
            json={
                "error": {
                    "message": "The model `gpt-5.5-2026-04-23` does not exist or you do not have access to it.",
                    "type": "invalid_request_error",
                    "code": "model_not_found",
                }
            },
            headers={"x-request-id": "req_test"},
            request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
        )

        with self.assertRaises(LLMProviderError) as raised:
            await OpenAIProvider().generate("Return JSON only.", '{"status":"ok"}')

        message = str(raised.exception)
        self.assertIn("400 Bad Request", message)
        self.assertIn("gpt-5.5-2026-04-23", message)
        self.assertIn("invalid_request_error", message)
        self.assertIn("model_not_found", message)
        self.assertIn("req_test", message)

    async def test_http_status_error_surfaces_non_json_body(self) -> None:
        FakeAsyncClient.response = httpx.Response(
            500,
            text="upstream unavailable",
            request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
        )

        with self.assertRaises(LLMProviderError) as raised:
            await OpenAIProvider().generate("Return JSON only.", '{"status":"ok"}')

        self.assertIn("500 Internal Server Error: upstream unavailable", str(raised.exception))

    async def test_generate_uses_model_default_temperature(self) -> None:
        FakeAsyncClient.response = httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"status":"ok"}'}}]},
            request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
        )

        await OpenAIProvider().generate("Return JSON only.", '{"status":"ok"}')

        self.assertIsNotNone(FakeAsyncClient.last_post_payload)
        self.assertNotIn("temperature", FakeAsyncClient.last_post_payload or {})

    async def test_list_models_returns_sorted_model_ids(self) -> None:
        FakeAsyncClient.response = httpx.Response(
            200,
            json={
                "data": [
                    {"id": "gpt-test-b", "object": "model"},
                    {"id": "gpt-test-a", "object": "model"},
                    {"object": "model"},
                ]
            },
            request=httpx.Request("GET", "https://api.openai.com/v1/models"),
        )

        models = await OpenAIProvider().list_models()

        self.assertEqual(models, ["gpt-test-a", "gpt-test-b"])


if __name__ == "__main__":
    unittest.main()
