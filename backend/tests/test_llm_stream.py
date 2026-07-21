"""Tests for POST /api/llm/agent-chat/stream (SSE streaming agent chat)."""

import json
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from helpers import admin_login, create_project


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
    assert kinds == ["token", "tool_start", "tool_end", "token", "done"]

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
