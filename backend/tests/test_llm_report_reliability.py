"""Reliability policy for the remote LLM report call."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import APIConnectionError

from app.services import llm_service as llm_module
from app.services.llm_service import (
    LLMNotConfiguredError,
    LLMReportInvalidResponseError,
    LLMReportTimeoutError,
    LLMService,
)
from app.services.report_service import REPORT_SECTION_TITLES

VALID_REPORT = "\n".join(f"## {section}\n内容" for section in REPORT_SECTION_TITLES)


def _response(content: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


class FakeClient:
    def __init__(self, responses, delay: float = 0):
        self.responses = list(responses)
        self.delay = delay
        self.calls = 0
        self.closed = False
        self.chat = SimpleNamespace(completions=self)

    async def create(self, **_kwargs):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        result = self.responses.pop(0)
        if isinstance(result, BaseException):
            raise result
        return _response(result)

    async def close(self):
        self.closed = True


async def _configure(monkeypatch, client: FakeClient, *, timeout=1.0, retries=1):
    async def credentials():
        return "sk-test", "https://llm.example/v1", "model-x"

    values = {
        "llm_report_timeout": timeout,
        "llm_report_max_retries": retries,
        "llm_report_retry_base_delay": 0.001,
    }

    async def get(key):
        return values[key]

    monkeypatch.setattr(llm_module.config_service, "get_llm_credentials", credentials)
    monkeypatch.setattr(llm_module.config_service, "get", get)
    monkeypatch.setattr(llm_module, "AsyncOpenAI", lambda **_kwargs: client)


@pytest.mark.asyncio
async def test_invalid_report_is_retried_then_succeeds(monkeypatch):
    client = FakeClient(["## 一、本期概览\n不完整", VALID_REPORT])
    await _configure(monkeypatch, client)

    report = await LLMService().generate_report("prompt")

    assert report == VALID_REPORT
    assert client.calls == 2
    assert client.closed is True


@pytest.mark.asyncio
async def test_network_error_is_retried_then_succeeds(monkeypatch):
    connection_error = APIConnectionError(
        request=httpx.Request("POST", "https://llm.example/v1/chat/completions")
    )
    client = FakeClient([connection_error, VALID_REPORT])
    await _configure(monkeypatch, client)

    report = await LLMService().generate_report("prompt")

    assert report == VALID_REPORT
    assert client.calls == 2


@pytest.mark.asyncio
async def test_invalid_report_after_retries_is_rejected(monkeypatch):
    client = FakeClient(["", "仍然不完整"])
    await _configure(monkeypatch, client)

    with pytest.raises(LLMReportInvalidResponseError):
        await LLMService().generate_report("prompt")

    assert client.calls == 2
    assert client.closed is True


@pytest.mark.asyncio
async def test_report_generation_has_total_timeout(monkeypatch):
    client = FakeClient([VALID_REPORT], delay=0.05)
    await _configure(monkeypatch, client, timeout=0.01, retries=0)

    with pytest.raises(LLMReportTimeoutError):
        await LLMService().generate_report("prompt")

    assert client.closed is True


@pytest.mark.asyncio
async def test_report_requires_api_key(monkeypatch):
    async def credentials():
        return "", "", "model-x"

    monkeypatch.setattr(llm_module.config_service, "get_llm_credentials", credentials)

    with pytest.raises(LLMNotConfiguredError):
        await LLMService().generate_report("prompt")
