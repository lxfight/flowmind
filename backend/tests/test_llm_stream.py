"""Tests for POST /api/llm/agent-chat/stream (SSE streaming agent chat)."""

import json
from unittest.mock import patch

import pytest
from helpers import admin_login, create_project
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage


def parse_sse(body: str) -> list[tuple[str, dict]]:
    """Parse SSE frames into (event, data) tuples."""
    events = []
    for frame in body.split("\n\n"):
        frame = frame.strip()
        if not frame or frame.startswith(":"):
            continue
        event = None
        data = None
        for line in frame.splitlines():
            if line.startswith("event: "):
                event = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        if event:
            events.append((event, data))
    return events


@pytest.mark.asyncio
async def test_stream_requires_auth(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="流式项目")
    resp = client.post(
        "/api/llm/agent-chat/stream",
        json={"project_id": project_id, "message": "你好"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_stream_happy_path_with_mocked_agent(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="流式项目")

    async def fake_stream(**kwargs):
        yield {"type": "status", "stage": "thinking", "message": "正在思考…"}
        yield {"type": "token", "text": "好的，"}
        yield {"type": "tool_start", "name": "create_task", "args": {"title": "任务A"}}
        yield {"type": "tool_end", "name": "create_task"}
        yield {"type": "token", "text": "已创建。"}
        yield {
            "type": "result",
            "result": {
                "message": "好的，已创建。",
                "actions": [{"type": "create_task", "task_id": 1, "title": "任务A"}],
                "messages": [
                    HumanMessage(content="帮我创建任务A"),
                    AIMessage(content="好的，已创建。"),
                ],
            },
        }

    with patch("app.api.llm.run_agent_stream", side_effect=lambda **kw: fake_stream(**kw)):
        resp = client.post(
            "/api/llm/agent-chat/stream",
            headers=headers,
            json={"project_id": project_id, "message": "帮我创建任务A"},
        )

    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(resp.text)
    kinds = [e for e, _ in events]
    assert kinds == ["status", "token", "tool_start", "tool_end", "token", "done"]

    status = next(d for e, d in events if e == "status")
    assert status["stage"] == "thinking"
    assert status["message"] == "正在思考…"

    tokens = [d["text"] for e, d in events if e == "token"]
    assert "".join(tokens) == "好的，已创建。"

    tool_start = next(d for e, d in events if e == "tool_start")
    assert tool_start["name"] == "create_task"

    done = next(d for e, d in events if e == "done")
    assert done["message"] == "好的，已创建。"
    assert done["actions"] == [{"type": "create_task", "task_id": 1, "title": "任务A"}]
    assert done["session_id"]

    # Messages persisted identically to the buffered endpoint
    detail = client.get(f"/api/llm/sessions/{done['session_id']}", headers=headers)
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "帮我创建任务A"),
        ("assistant", "好的，已创建。"),
    ]
    assert messages[1]["actions"] == [{"type": "create_task", "task_id": 1, "title": "任务A"}]


@pytest.mark.asyncio
async def test_stream_agent_error_yields_done_with_message(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="流式项目")

    async def fake_stream(**kwargs):
        yield {
            "type": "result",
            "result": {"message": "LLM 未配置，请在环境变量中设置 LLM_API_KEY。", "actions": [], "messages": []},
        }

    with patch("app.api.llm.run_agent_stream", side_effect=lambda **kw: fake_stream(**kw)):
        resp = client.post(
            "/api/llm/agent-chat/stream",
            headers=headers,
            json={"project_id": project_id, "message": "你好"},
        )

    assert resp.status_code == 200, resp.text
    events = parse_sse(resp.text)
    assert [e for e, _ in events] == ["done"]
    assert "LLM 未配置" in events[0][1]["message"]


@pytest.mark.asyncio
async def test_run_agent_stream_yields_status_first():
    """run_agent_stream must emit a status event before any LLM output so the
    client is never fully silent during the first tool-decision call."""
    from app.services import agent_service

    class FakeAgent:
        async def astream_events(self, input, config=None, version=None):
            yield {
                "event": "on_tool_start",
                "name": "search_knowledge",
                "run_id": "run-1",
                "data": {"input": {"query": "AI 新闻"}},
            }
            yield {
                "event": "on_tool_end",
                "name": "search_knowledge",
                "run_id": "run-1",
                "data": {"output": "检索到 2 条结果"},
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessageChunk(content="你好")},
            }
            yield {
                "event": "on_chain_end",
                "name": "LangGraph",
                "data": {"output": {"messages": [HumanMessage(content="hi"), AIMessage(content="你好")]}},
            }

    built = (FakeAgent(), [HumanMessage(content="hi")], {}, [], None, "batch-1")

    async def fake_build(*args, **kwargs):
        return built

    with patch.object(agent_service, "_build_agent_run", side_effect=fake_build):
        events = [
            evt
            async for evt in agent_service.run_agent_stream(
                db=None, user=None, project_id=1, user_message="hi"
            )
        ]

    assert events[0] == {"type": "status", "stage": "thinking", "message": "正在思考…"}
    kinds = [e["type"] for e in events]
    assert kinds == ["status", "tool_start", "tool_end", "token", "result"]

    tool_start = next(e for e in events if e["type"] == "tool_start")
    assert tool_start["id"] == "run-1"
    assert tool_start["name"] == "search_knowledge"

    tool_end = next(e for e in events if e["type"] == "tool_end")
    assert tool_end["id"] == "run-1"
    assert tool_end["output"] == "检索到 2 条结果"

    assert events[-1]["result"]["message"] == "你好"


@pytest.mark.asyncio
async def test_run_agent_stream_ignores_inner_chain_end():
    """Internal graph nodes also fire on_chain_end with a partial ``messages``
    output (dropping tool messages); only the top-level LangGraph output must
    be used as the final result."""
    from app.services import agent_service

    full = [
        HumanMessage(content="hi"),
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "search_knowledge", "args": {"query": "x"}}]),
        ToolMessage(content="检索结果", tool_call_id="c1", name="search_knowledge"),
        AIMessage(content="你好"),
    ]

    class FakeAgent:
        async def astream_events(self, input, config=None, version=None):
            # An inner node end whose messages omit the tool exchange.
            yield {
                "event": "on_chain_end",
                "name": "call_model",
                "data": {"output": {"messages": [AIMessage(content="partial")]}},
            }
            yield {
                "event": "on_chain_end",
                "name": "LangGraph",
                "data": {"output": {"messages": full}},
            }

    built = (FakeAgent(), [HumanMessage(content="hi")], {}, [], None, "batch-1")

    async def fake_build(*args, **kwargs):
        return built

    with patch.object(agent_service, "_build_agent_run", side_effect=fake_build):
        events = [
            evt
            async for evt in agent_service.run_agent_stream(
                db=None, user=None, project_id=1, user_message="hi"
            )
        ]

    result = events[-1]["result"]
    assert result["message"] == "你好"
    # The full top-level messages (incl. the ToolMessage) are what get persisted.
    assert result["messages"] is full


@pytest.mark.asyncio
async def test_run_agent_stream_emits_thinking_events():
    """Reasoning/thinking chunks from the provider stream as thinking events."""
    from app.services import agent_service

    thinking_chunk = AIMessageChunk(content="")
    thinking_chunk.additional_kwargs["reasoning_content"] = "先检索知识库…"

    class FakeAgent:
        async def astream_events(self, input, config=None, version=None):
            yield {"event": "on_chat_model_stream", "data": {"chunk": thinking_chunk}}
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessageChunk(content="结论")},
            }
            yield {
                "event": "on_chain_end",
                "name": "LangGraph",
                "data": {"output": {"messages": [HumanMessage(content="hi"), AIMessage(content="结论")]}},
            }

    built = (FakeAgent(), [HumanMessage(content="hi")], {}, [], None, "batch-1")

    async def fake_build(*args, **kwargs):
        return built

    with patch.object(agent_service, "_build_agent_run", side_effect=fake_build):
        events = [
            evt
            async for evt in agent_service.run_agent_stream(
                db=None, user=None, project_id=1, user_message="hi"
            )
        ]

    kinds = [e["type"] for e in events]
    assert kinds == ["status", "thinking", "token", "result"]
    thinking = next(e for e in events if e["type"] == "thinking")
    assert thinking["text"] == "先检索知识库…"
