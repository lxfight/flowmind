"""Coverage for the structured clarifying-question flow (ask_user tool).

- ask_user records the pending question and returns a stop sentinel.
- run results (buffered + streaming) surface pending_question.
- Sessions are marked awaiting_input and the flag clears on the next send.
- The user's answer is wrapped with the question context for the LLM only.
- The system prompt carries the new decision rules.
"""
import json
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy import select

from app.models.user import User
from app.services import agent_service
from app.services.agent_service import ask_user, _finalize_result
from conftest import async_session_factory
from helpers import admin_login, create_project
from test_llm_stream import parse_sse


async def _tool_config(project_id: int):
    session = async_session_factory()
    result = await session.execute(select(User).where(User.username == "admin"))
    user = result.scalars().first()
    assert user is not None
    pending: dict = {}
    config = {
        "configurable": {
            "db": session,
            "user": user,
            "project_id": project_id,
            "actions": [],
            "pending_question": pending,
        }
    }
    return config, session, pending


@pytest.mark.asyncio
async def test_ask_user_records_pending_question_and_sentinel(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="提问项目")
    config, session, pending = await _tool_config(project_id)
    try:
        result = await ask_user.ainvoke(
            {"question": "这个任务要指派给谁？", "options": ["张三", "李四"]},
            config=config,
        )
        assert pending == {"question": "这个任务要指派给谁？", "options": ["张三", "李四"]}
        assert "已向用户提问" in result
        assert "结束本轮" in result
    finally:
        await session.close()


def test_finalize_result_includes_pending_question():
    messages = [HumanMessage(content="hi"), AIMessage(content="请问指派给谁？")]
    pending = {"question": "请问指派给谁？", "options": None}
    result = _finalize_result(messages, [], pending)
    assert result["pending_question"] == pending

    result_none = _finalize_result(messages, [], {})
    assert result_none["pending_question"] is None


def test_system_prompt_has_clarifying_rules():
    prompt = agent_service._build_system_prompt(
        {"project_name": "P", "project_description": ""}
    )
    assert "澄清提问规则" in prompt
    assert "ask_user" in prompt
    assert "search_knowledge 查证" in prompt
    assert "调用 ask_user 后立即结束本轮" in prompt


@pytest.mark.asyncio
async def test_stream_done_payload_and_session_awaiting_lifecycle(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="提问项目")
    pending = {"question": "这个任务要指派给谁？", "options": ["张三", "李四"]}

    async def fake_stream(**kwargs):
        yield {"type": "token", "text": "这个任务要指派给谁？"}
        yield {
            "type": "result",
            "result": {
                "message": "这个任务要指派给谁？",
                "actions": [],
                "messages": [
                    HumanMessage(content="帮我建个任务"),
                    AIMessage(content="这个任务要指派给谁？"),
                ],
                "pending_question": pending,
            },
        }

    with patch("app.api.llm.run_agent_stream", side_effect=lambda **kw: fake_stream(**kw)):
        resp = client.post(
            "/api/llm/agent-chat/stream",
            headers=headers,
            json={"project_id": project_id, "message": "帮我建个任务"},
        )

    assert resp.status_code == 200, resp.text
    events = parse_sse(resp.text)
    done = next(d for e, d in events if e == "done")
    assert done["pending_question"] == pending

    session_id = done["session_id"]
    detail = client.get(f"/api/llm/sessions/{session_id}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["awaiting_input"] is True
    assistant_msg = next(m for m in body["messages"] if m["role"] == "assistant")
    assert assistant_msg["pending_question"] == pending

    # Session list also exposes the flag
    sessions = client.get(
        "/api/llm/sessions", headers=headers, params={"project_id": project_id}
    ).json()
    assert next(s for s in sessions if s["id"] == session_id)["awaiting_input"] is True

    # The user's next message is wrapped with the question context for the LLM,
    # and the session's awaiting flag clears.
    captured: dict = {}

    async def fake_run(**kwargs):
        captured.update(kwargs)
        return {
            "message": "好的，已指派给张三。",
            "actions": [],
            "messages": [
                HumanMessage(content=kwargs["user_message"]),
                AIMessage(content="好的，已指派给张三。"),
            ],
            "pending_question": None,
        }

    with patch("app.api.llm.run_agent", side_effect=fake_run):
        resp = client.post(
            "/api/llm/agent-chat",
            headers=headers,
            json={
                "project_id": project_id,
                "session_id": session_id,
                "message": "张三",
            },
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["pending_question"] is None
    assert captured["user_message"] == "[用户在回答助手的问题：这个任务要指派给谁？] 用户回答：张三"

    detail = client.get(f"/api/llm/sessions/{session_id}", headers=headers)
    body = detail.json()
    assert body["awaiting_input"] is False
    # The DB keeps the user's raw text, not the injected wrapper.
    user_msgs = [m for m in body["messages"] if m["role"] == "user"]
    assert user_msgs[-1]["content"] == "张三"


@pytest.mark.asyncio
async def test_buffered_response_includes_pending_question(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="提问项目")
    pending = {"question": "截止日期是哪天？", "options": None}

    async def fake_run(**kwargs):
        return {
            "message": "截止日期是哪天？",
            "actions": [],
            "messages": [
                HumanMessage(content="建个任务"),
                AIMessage(content="截止日期是哪天？"),
            ],
            "pending_question": pending,
        }

    with patch("app.api.llm.run_agent", side_effect=fake_run):
        resp = client.post(
            "/api/llm/agent-chat",
            headers=headers,
            json={"project_id": project_id, "message": "建个任务"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["pending_question"] == pending

    detail = client.get(f"/api/llm/sessions/{data['session_id']}", headers=headers)
    assert detail.json()["awaiting_input"] is True
