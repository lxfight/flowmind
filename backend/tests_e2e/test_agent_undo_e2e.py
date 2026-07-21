"""E2E test for the full agent loop: streaming agent chat -> REAL tool
execution against the DB -> user undoes the action batch -> rollback verified.

Run from backend/ dir:  python -m tests_e2e.test_agent_undo_e2e

Mock seam: only the LLM "brain" is replaced. We patch
``app.services.agent_service.ChatOpenAI`` (the constructor used inside
``_build_agent_run``) with a scripted fake ``BaseChatModel`` that emits
predetermined AIMessages (tool call, then final answer). Everything else is
real: the SSE endpoint, the LangGraph ReAct loop, the actual tools
(create_task / update_task), task_service's batch-id contextvar + ActivityLog
snapshots, message/session persistence, and undo_service compensation.

NOTE: patching ``run_agent_stream`` (as the unit tests in tests/ do) would
bypass tool execution and therefore the whole snapshot/batch/undo machinery,
so it is NOT used here.
"""
import json
import os
import tempfile
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(
    tempfile.mkdtemp(), "agent_undo_test.db"
)
os.environ["FLOWMIND_ADMIN_PASSWORD"] = "adminpass123"
# Must be non-empty BEFORE app import: agent_service checks
# settings.llm_api_key and bails out with "LLM 未配置" otherwise.
os.environ["LLM_API_KEY"] = "dummy-key-for-e2e"

from fastapi.testclient import TestClient  # noqa: E402
from langchain_core.language_models.chat_models import BaseChatModel  # noqa: E402
from langchain_core.messages import AIMessage, AIMessageChunk  # noqa: E402
from langchain_core.outputs import (  # noqa: E402
    ChatGeneration,
    ChatGenerationChunk,
    ChatResult,
)

from app.main import app  # noqa: E402
from app.services import agent_service  # noqa: E402

PASS = "password123"
failures = []


def check(name, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name} {extra}")
    if not cond:
        failures.append(name)


class ScriptedChatModel(BaseChatModel):
    """Fake chat model that replays a queue of scripted AIMessages.

    Each model invocation pops one message. bind_tools is a no-op returning
    self so langgraph's create_react_agent accepts it; tool calls are already
    baked into the scripted AIMessages, so the REAL tools still execute.
    """

    scripted: list

    @property
    def _llm_type(self) -> str:
        return "scripted-fake"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN201
        return self

    def _next(self) -> AIMessage:
        if not self.scripted:
            raise AssertionError("ScriptedChatModel ran out of scripted messages")
        return self.scripted.pop(0)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self._next())])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        # Single chunk per message; AIMessageChunk converts tool_calls into
        # tool_call_chunks, which merge back into the full tool call.
        msg = self._next()
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content=msg.content or "",
                tool_calls=list(msg.tool_calls or []),
            )
        )


def parse_sse(body: str) -> list[tuple[str, dict]]:
    """Parse SSE frames into (event, data) tuples (same shape as unit tests)."""
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


def run_stream(client, headers, payload, scripted_messages):
    """POST /api/llm/agent-chat/stream with the scripted model; return events."""
    fake = ScriptedChatModel(scripted=list(scripted_messages))
    with patch.object(agent_service, "ChatOpenAI", lambda **kw: fake):
        resp = client.post("/api/llm/agent-chat/stream", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/event-stream")
    return parse_sse(resp.text)


with TestClient(app) as client:
    # --- setup: admin login, project, status column (real API calls)
    r = client.post("/api/auth/login", data={"username": "admin", "password": "adminpass123"})
    check("admin login", r.status_code == 200, str(r.status_code))
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = client.post("/api/projects", json={"name": "Agent撤销测试", "description": "", "color": "#3b82f6"},
                    headers=headers)
    check("create project", r.status_code == 201, r.text[:200])
    pid = r.json()["id"]

    r = client.get(f"/api/projects/{pid}/statuses", headers=headers)
    open_status = next(s for s in r.json() if not s["is_done"])

    # =====================================================================
    # Round 1: agent creates a task via the REAL create_task tool, then undo
    # =====================================================================
    events = run_stream(
        client, headers,
        {"project_id": pid, "message": "帮我创建一个任务叫冒烟任务"},
        [
            AIMessage(content="", tool_calls=[{
                "id": "call_create",
                "name": "create_task",
                "args": {"title": "冒烟任务", "status_id": open_status["id"]},
            }]),
            AIMessage(content="已创建任务「冒烟任务」。"),
        ],
    )
    kinds = [e for e, _ in events]
    check("SSE contains token/tool_start/tool_end/done",
          "tool_start" in kinds and "tool_end" in kinds and "done" in kinds,
          str(kinds))
    check("SSE token events streamed", "token" in kinds, str(kinds))

    tool_start = next((d for e, d in events if e == "tool_start"), {})
    check("tool_start is create_task", tool_start.get("name") == "create_task", str(tool_start))

    done = next((d for e, d in events if e == "done"), {})
    session_id = done.get("session_id")
    batch_id = done.get("action_batch_id")
    check("done has session_id", bool(session_id), str(done))
    check("done has action_batch_id", bool(batch_id), str(done))
    create_actions = [a for a in done.get("actions", []) if a.get("type") == "create_task"]
    check("done actions include create_task", len(create_actions) == 1, str(done.get("actions")))
    task_id = create_actions[0]["task_id"] if create_actions else None

    # Task really exists via the tasks API
    r = client.get(f"/api/projects/{pid}/tasks", headers=headers)
    tasks = r.json()
    task_items = tasks["items"] if isinstance(tasks, dict) else tasks
    created = next((t for t in task_items if t["id"] == task_id), None)
    check("task exists in DB via tasks API",
          created is not None and created["title"] == "冒烟任务",
          str(created))

    # Assistant message persisted with actions + batch id
    r = client.get(f"/api/llm/sessions/{session_id}", headers=headers)
    check("session detail 200", r.status_code == 200, r.text[:200])
    msgs = r.json()["messages"]
    assistant = [m for m in msgs if m["role"] == "assistant"][-1]
    check("assistant message persisted with actions",
          any(a.get("type") == "create_task" for a in (assistant.get("actions") or [])),
          str(assistant.get("actions")))
    check("assistant message carries action_batch_id",
          assistant.get("action_batch_id") == batch_id, str(assistant.get("action_batch_id")))
    check("assistant message not undone yet", assistant.get("undone_at") is None, "")

    # Undo the batch -> task deleted
    r = client.post(f"/api/llm/sessions/{session_id}/undo", headers=headers)
    check("undo returns 200", r.status_code == 200, r.text[:300])
    body = r.json()
    check("undo reports undone entries", len(body.get("undone", [])) >= 1, str(body))
    check("undo reports no skips", body.get("skipped") == [], str(body))

    r = client.get(f"/api/projects/{pid}/tasks/{task_id}", headers=headers)
    check("task gone after undo", r.status_code == 404, str(r.status_code))

    # Second undo rejected (batch already undone)
    r = client.post(f"/api/llm/sessions/{session_id}/undo", headers=headers)
    check("second undo rejected with 404", r.status_code == 404, r.text[:200])

    # =====================================================================
    # Round 2: agent updates a task title via the REAL update_task tool,
    # then undo restores the old title (restore path)
    # =====================================================================
    r = client.post(f"/api/projects/{pid}/tasks", json={
        "title": "原始标题", "status_id": open_status["id"],
    }, headers=headers)
    check("seed task for update round", r.status_code == 201, r.text[:200])
    upd_id = r.json()["id"]

    events2 = run_stream(
        client, headers,
        {"project_id": pid, "session_id": session_id, "message": "把任务标题改成新标题"},
        [
            AIMessage(content="", tool_calls=[{
                "id": "call_update",
                "name": "update_task",
                "args": {"task_id": upd_id, "title": "改后标题"},
            }]),
            AIMessage(content="已更新任务标题。"),
        ],
    )
    done2 = next((d for e, d in events2 if e == "done"), {})
    check("round 2 done in same session", done2.get("session_id") == session_id, str(done2))
    check("round 2 has update_task action",
          any(a.get("type") == "update_task" for a in done2.get("actions", [])),
          str(done2.get("actions")))

    r = client.get(f"/api/projects/{pid}/tasks/{upd_id}", headers=headers)
    check("title updated by real tool", r.status_code == 200 and r.json()["title"] == "改后标题",
          r.text[:200])

    r = client.post(f"/api/llm/sessions/{session_id}/undo", headers=headers)
    check("round 2 undo returns 200", r.status_code == 200, r.text[:300])
    check("round 2 undo has no skips", r.json().get("skipped") == [], r.text[:300])

    r = client.get(f"/api/projects/{pid}/tasks/{upd_id}", headers=headers)
    check("undo restored original title", r.status_code == 200 and r.json()["title"] == "原始标题",
          r.text[:200])

    # Assistant message of round 2 now marked undone
    r = client.get(f"/api/llm/sessions/{session_id}", headers=headers)
    assistants = [m for m in r.json()["messages"]
                  if m["role"] == "assistant" and m.get("action_batch_id")]
    check("both assistant batches marked undone",
          len(assistants) == 2 and all(m.get("undone_at") is not None for m in assistants),
          str([(m.get("action_batch_id"), m.get("undone_at")) for m in assistants]))

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL TESTS PASSED")
