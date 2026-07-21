import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.permissions import ensure_project_member
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.llm_chat import LLMChatMessage, LLMChatSession
from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.schemas import (
    LLMAgentChatRequest,
    LLMAgentChatResponse,
    LLMChatRequest,
    LLMChatResponse,
    LLMChatSessionCreate,
    LLMChatSessionDetailOut,
    LLMChatSessionOut,
    LLMChatSessionUpdate,
    LLMTaskGenerate,
    SessionScope,
)
from app.services.agent_service import run_agent, run_agent_stream
from app.services.llm_service import llm_service
from app.services.mention_service import board_link, notify_mentions
from app.services.rag_service import rag_service
from app.services.report_service import (
    ACTIVITY_WINDOW_DAYS,
    ReportTask,
    build_report_prompt,
    compute_report_stats,
    format_stats_text,
)
from app.services.undo_service import undo_batch

router = APIRouter(prefix="/api/llm", tags=["llm"])

logger = logging.getLogger(__name__)


@router.post("/chat", response_model=LLMChatResponse)
async def llm_chat(
    request: LLMChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Chat with LLM with project context from knowledge base."""
    await ensure_project_member(request.project_id, current_user, db)
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    # Try to enhance with knowledge base context
    last_user_msg = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
    )

    context = ""
    if last_user_msg and request.project_id:
        try:
            contexts = await rag_service.retrieve_context(
                query=last_user_msg,
                project_id=request.project_id,
                db=db,
            )
            if contexts:
                context = "\n\n相关文档参考：\n" + "\n".join(
                    f"- [{c['doc_title']}] {c['content'][:200]}"
                    for c in contexts
                )
        except Exception as exc:
            # Retrieval failure must not break chat; log it for diagnosis.
            logger.warning(
                "知识库检索失败（已跳过上下文增强，继续聊天）: %s", exc, exc_info=True
            )

    system_prompt = (
        "你是 FlowMind 智能助手，帮助用户管理任务和项目。"
        "你可以回答项目相关问题、建议任务安排、分析项目进度等。"
        "请用中文回答，保持专业和友好。" + context
    )

    try:
        response = await llm_service.chat(messages, system_prompt=system_prompt)
    except Exception as e:
        response = f"抱歉，LLM 响应出错: {str(e)}"

    return LLMChatResponse(message=response)


@router.post("/generate-tasks", response_model=list)
async def llm_generate_tasks(
    request: LLMTaskGenerate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate tasks from natural language instructions using LLM."""
    await ensure_project_member(request.project_id, current_user, db)
    # Build project context
    result = await db.execute(
        select(TaskStatus)
        .where(TaskStatus.project_id == request.project_id)
        .order_by(TaskStatus.order)
    )
    statuses = result.scalars().all()
    status_names = [s.name for s in statuses]

    result = await db.execute(
        select(Task).where(
            Task.project_id == request.project_id,
            Task.parent_task_id.is_(None),
        ).limit(20)
    )
    existing_tasks = result.scalars().all()
    task_context = f"当前项目共有 {len(existing_tasks)} 个任务"

    project_context = f"项目状态列: {', '.join(status_names)}\n{task_context}"

    try:
        generated = await llm_service.generate_tasks(request.instruction, project_context)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"任务生成失败: {str(e)}") from e

    return generated


@router.post("/suggest-status")
async def llm_suggest_status(
    project_id: int,
    task_title: str,
    task_description: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Suggest which status a newly created task should go to."""
    await ensure_project_member(project_id, current_user, db)
    result = await db.execute(
        select(TaskStatus)
        .where(TaskStatus.project_id == project_id)
        .order_by(TaskStatus.order)
    )
    statuses = result.scalars().all()

    if not statuses:
        return {"suggested_status": None}

    status_names = [s.name for s in statuses]
    try:
        suggested = await llm_service.suggest_status(
            task_title, task_description, status_names
        )
    except Exception:
        suggested = status_names[0]

    # Match suggested name to status id
    for s in statuses:
        if s.name == suggested:
            return {"suggested_status": s.id, "suggested_name": s.name}

    return {"suggested_status": statuses[0].id, "suggested_name": statuses[0].name}


@router.post("/report")
async def llm_report(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a project progress report using LLM."""
    await ensure_project_member(project_id, current_user, db)
    # Get project
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # Get all top-level tasks with status names, assignees and subtask counts
    result = await db.execute(
        select(Task, TaskStatus.name, TaskStatus.is_done)
        .join(TaskStatus, Task.status_id == TaskStatus.id)
        .where(Task.project_id == project_id, Task.parent_task_id.is_(None))
        .options(selectinload(Task.assignees))
        .order_by(TaskStatus.order, Task.order)
    )
    rows = result.all()

    # Subtask counts per parent task
    subtask_counts: dict[int, tuple[int, int]] = {}
    if rows:
        result = await db.execute(
            select(
                Task.parent_task_id,
                func.count(Task.id),
                func.coalesce(func.sum(Task.is_completed.cast(Integer)), 0),
            )
            .where(
                Task.project_id == project_id,
                Task.parent_task_id.is_not(None),
            )
            .group_by(Task.parent_task_id)
        )
        subtask_counts = {pid: (total, done) for pid, total, done in result.all()}

    # Get activity logs from the recent window
    from app.models.activity import ActivityLog
    window_start = datetime.now(UTC) - timedelta(days=ACTIVITY_WINDOW_DAYS)
    result = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.project_id == project_id,
            ActivityLog.created_at >= window_start,
        )
        .order_by(ActivityLog.created_at.desc())
    )
    logs = result.scalars().all()

    now = datetime.now(UTC)
    report_tasks = [
        ReportTask(
            title=t.title,
            status_name=sname,
            status_is_done=is_done,
            priority=t.priority,
            is_completed=t.is_completed,
            due_date=t.due_date,
            updated_at=t.updated_at,
            assignees=[u.display_name or u.username for u in t.assignees],
            subtask_total=subtask_counts.get(t.id, (0, 0))[0],
            subtask_done=subtask_counts.get(t.id, (0, 0))[1],
        )
        for t, sname, is_done in rows
    ]

    # Precompute all statistics in Python — never ask the LLM to count.
    stats = compute_report_stats(report_tasks, now=now)
    activity_lines = [log.summary for log in logs[:20]]
    stats_text = format_stats_text(stats, report_tasks, activity_lines, now=now)
    prompt = build_report_prompt(
        project.name, project.description or "", stats_text
    )

    report = await llm_service.generate_report(prompt)

    return {"report": report, "generated_at": now.isoformat()}


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------
@router.get("/sessions", response_model=list[LLMChatSessionOut])
async def list_sessions(
    project_id: int | None = None,
    scope: SessionScope = "project",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the current user's chat sessions.

    ``scope=project`` (default) requires ``project_id`` and returns that
    project's sessions; ``scope=all_my_projects`` returns cross-project
    sessions (``project_id`` is NULL on those).
    """
    stmt = select(LLMChatSession).where(LLMChatSession.user_id == current_user.id)
    if scope == "all_my_projects":
        stmt = stmt.where(LLMChatSession.project_id.is_(None))
    else:
        if project_id is None:
            raise HTTPException(
                status_code=422, detail="scope=project 时 project_id 必填"
            )
        await ensure_project_member(project_id, current_user, db)
        stmt = stmt.where(LLMChatSession.project_id == project_id)
    result = await db.execute(stmt.order_by(LLMChatSession.updated_at.desc()))
    return result.scalars().all()


@router.post("/sessions", response_model=LLMChatSessionOut, status_code=201)
async def create_session(
    data: LLMChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # project_id=None creates a cross-project session (no membership check —
    # the scope is resolved per run from the user's current memberships).
    if data.project_id is not None:
        await ensure_project_member(data.project_id, current_user, db)
    session = LLMChatSession(
        user_id=current_user.id,
        project_id=data.project_id,
        title=data.title or "新会话",
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=LLMChatSessionDetailOut)
async def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LLMChatSession)
        .where(LLMChatSession.id == session_id)
        .options(selectinload(LLMChatSession.messages))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id and not current_user.is_superuser:
        # 404 rather than 403: do not leak the existence of others' sessions
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.project_id is not None:  # cross-project sessions have no project
        await ensure_project_member(session.project_id, current_user, db)
    return session


@router.put("/sessions/{session_id}", response_model=LLMChatSessionOut)
async def update_session(
    session_id: int,
    data: LLMChatSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LLMChatSession).where(LLMChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=404, detail="会话不存在")  # 不泄露他人会话存在性
    if session.project_id is not None:  # cross-project sessions have no project
        await ensure_project_member(session.project_id, current_user, db)
    session.title = data.title
    await db.flush()
    await db.refresh(session)
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LLMChatSession).where(LLMChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=404, detail="会话不存在")  # 不泄露他人会话存在性
    if session.project_id is not None:  # cross-project sessions have no project
        await ensure_project_member(session.project_id, current_user, db)
    await db.delete(session)
    return {"message": "会话已删除"}


# ---------------------------------------------------------------------------
# Undo of agent action batches
# ---------------------------------------------------------------------------
@router.post("/sessions/{session_id}/undo")
async def undo_agent_actions(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Undo the most recent undoable agent action batch in this session.

    Only the session owner may undo; each batch can be undone once. Entries
    whose target entity has since vanished are skipped and reported.
    """
    result = await db.execute(
        select(LLMChatSession).where(LLMChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=404, detail="会话不存在")  # 不泄露他人会话存在性
    if session.project_id is not None:  # cross-project sessions have no project
        await ensure_project_member(session.project_id, current_user, db)

    # Most recent assistant message with a batch that is not yet undone and
    # actually produced activity rows.
    result = await db.execute(
        select(LLMChatMessage)
        .where(
            LLMChatMessage.session_id == session.id,
            LLMChatMessage.role == "assistant",
            LLMChatMessage.action_batch_id.is_not(None),
            LLMChatMessage.undone_at.is_(None),
        )
        .order_by(LLMChatMessage.ordinal.desc())
    )
    from app.models.activity import ActivityLog

    target: LLMChatMessage | None = None
    for candidate in result.scalars().all():
        rows = await db.execute(
            select(ActivityLog.id)
            .where(ActivityLog.action_batch_id == candidate.action_batch_id)
            .limit(1)
        )
        if rows.first() is not None:
            target = candidate
            break
    if target is None:
        raise HTTPException(status_code=404, detail="没有可撤销的操作")

    return await undo_batch(db, target, current_user)


# ---------------------------------------------------------------------------
# Agent chat
# ---------------------------------------------------------------------------
async def _resolve_chat_session(
    request: LLMAgentChatRequest,
    current_user: User,
    db: AsyncSession,
) -> LLMChatSession:
    """Resolve or create the chat session for an agent-chat request.

    scope="project" requires project_id (with membership check) and a
    matching single-project session; scope="all_my_projects" uses / creates
    a cross-project session (project_id NULL).
    """
    if request.scope == "all_my_projects":
        if request.project_id is not None:
            raise HTTPException(
                status_code=422, detail="scope=all_my_projects 时不能传 project_id"
            )
        expected_pid: int | None = None
    else:
        if request.project_id is None:
            raise HTTPException(
                status_code=422, detail="scope=project 时 project_id 必填"
            )
        await ensure_project_member(request.project_id, current_user, db)
        expected_pid = request.project_id

    session: LLMChatSession | None = None
    if request.session_id:
        result = await db.execute(
            select(LLMChatSession).where(LLMChatSession.id == request.session_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        if session.user_id != current_user.id and not current_user.is_superuser:
            # 404 rather than 403: do not leak the existence of others' sessions
            raise HTTPException(status_code=404, detail="会话不存在")
        if session.project_id != expected_pid:
            detail = "会话不属于该项目" if expected_pid is not None else "该会话不是跨项目会话"
            raise HTTPException(status_code=403, detail=detail)
    else:
        title = request.message.strip()[:20] or "新会话"
        session = LLMChatSession(
            user_id=current_user.id,
            project_id=expected_pid,
            title=title,
        )
        db.add(session)
        await db.flush()
        await db.refresh(session)

    return session


async def _load_history(session: LLMChatSession, db: AsyncSession) -> list[dict]:
    """Load session history as plain dicts."""
    result = await db.execute(
        select(LLMChatMessage)
        .where(LLMChatMessage.session_id == session.id)
        .order_by(LLMChatMessage.ordinal)
    )
    return [
        {
            "role": m.role,
            "content": m.content,
            "tool_calls": m.tool_calls,
            "tool_results": m.tool_results,
        }
        for m in result.scalars().all()
    ]


async def _consume_pending_answer_context(
    session: LLMChatSession, db: AsyncSession, user_message: str
) -> str:
    """When the session is awaiting an answer to a pending question, wrap the
    user message with the question context for the LLM and clear the flag.

    The raw user text stays untouched in the DB; only the LLM-bound message
    is annotated.
    """
    if not session.awaiting_input:
        return user_message
    question = None
    result = await db.execute(
        select(LLMChatMessage)
        .where(
            LLMChatMessage.session_id == session.id,
            LLMChatMessage.role == "assistant",
            LLMChatMessage.pending_question.is_not(None),
        )
        .order_by(LLMChatMessage.ordinal.desc())
        .limit(1)
    )
    msg = result.scalars().first()
    if msg and isinstance(msg.pending_question, dict):
        question = msg.pending_question.get("question")
    session.awaiting_input = False
    await db.flush()
    if question:
        return f"[用户在回答助手的问题：{question}] 用户回答：{user_message}"
    return user_message


async def _persist_agent_run(
    db: AsyncSession,
    session: LLMChatSession,
    result: dict,
    history_len: int,
    user_message: str,
) -> list[dict]:
    """Persist new messages from an agent run and return deduplicated actions.

    Shared by the buffered and streaming agent-chat endpoints.
    """
    # Persist only new messages returned by the agent run (skip replayed history)
    max_ordinal_result = await db.execute(
        select(func.max(LLMChatMessage.ordinal)).where(LLMChatMessage.session_id == session.id)
    )
    next_ordinal = (max_ordinal_result.scalar() or 0) + 1

    persisted_messages = []
    returned_messages = result.get("messages", [])
    new_messages = returned_messages[history_len:]
    if not new_messages:
        # Configuration and provider errors still belong to the visible session history.
        new_messages = [
            HumanMessage(content=user_message),
            AIMessage(content=result.get("message", "")),
        ]
    for msg in new_messages:
        if isinstance(msg, HumanMessage):
            db_msg = LLMChatMessage(
                session_id=session.id,
                role="user",
                content=msg.content or "",
                ordinal=next_ordinal,
            )
            db.add(db_msg)
            persisted_messages.append(db_msg)
            next_ordinal += 1
        elif isinstance(msg, AIMessage):
            db_msg = LLMChatMessage(
                session_id=session.id,
                role="assistant",
                content=msg.content or "",
                tool_calls=[
                    {
                        "id": tc.get("id", ""),
                        "tool": tc.get("name", ""),
                        "arguments": tc.get("args", {}),
                    }
                    for tc in (msg.tool_calls or [])
                ] if msg.tool_calls else None,
                ordinal=next_ordinal,
            )
            db.add(db_msg)
            persisted_messages.append(db_msg)
            next_ordinal += 1
        elif isinstance(msg, ToolMessage):
            db_msg = LLMChatMessage(
                session_id=session.id,
                role="tool",
                content=msg.content or "",
                tool_results=[
                    {
                        "tool_call_id": msg.tool_call_id,
                        "tool": getattr(msg, "name", ""),
                        "message": msg.content or "",
                    }
                ],
                ordinal=next_ordinal,
            )
            db.add(db_msg)
            persisted_messages.append(db_msg)
            next_ordinal += 1

    # Persist actions on the final assistant message if any
    if result.get("actions") and persisted_messages:
        # Find last assistant message
        for db_msg in reversed(persisted_messages):
            if db_msg.role == "assistant":
                db_msg.actions = result["actions"]
                break

    session.updated_at = datetime.now(UTC)
    await db.flush()

    # Collect actions from tool results as well (more reliable than shared config)
    actions = list(result.get("actions") or [])
    for msg in new_messages:
        if isinstance(msg, ToolMessage):
            try:
                data = json.loads(msg.content or "{}")
                if isinstance(data, dict) and data.get("action"):
                    actions.append(data["action"])
            except Exception:
                pass

    # Deduplicate by type+task_id/status_id
    seen = set()
    unique_actions = []
    for a in actions:
        key = (a.get("type"), a.get("task_id"), a.get("status_id"))
        if key not in seen:
            seen.add(key)
            unique_actions.append(a)

    if unique_actions:
        for db_msg in reversed(persisted_messages):
            if db_msg.role == "assistant":
                db_msg.actions = unique_actions
                break

    # Persist a pending clarifying question on the final assistant message and
    # mark the session as awaiting the user's answer.
    pending_question = result.get("pending_question")
    if pending_question:
        for db_msg in reversed(persisted_messages):
            if db_msg.role == "assistant":
                db_msg.pending_question = pending_question
                break
        session.awaiting_input = True
        await db.flush()

    # Stamp the run's action batch id on the final assistant message so the
    # whole run can be undone via /sessions/{id}/undo.
    action_batch_id = result.get("action_batch_id")
    if action_batch_id:
        for db_msg in reversed(persisted_messages):
            if db_msg.role == "assistant":
                db_msg.action_batch_id = action_batch_id
                break
        await db.flush()

    return unique_actions


@router.post("/agent-chat", response_model=LLMAgentChatResponse)
async def agent_chat(
    request: LLMAgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _resolve_chat_session(request, current_user, db)
    history = await _load_history(session, db)
    llm_message = await _consume_pending_answer_context(session, db, request.message)

    # Notify project members @-mentioned in the user's message (plain text
    # stays as-is for the LLM; unknown names are ignored).
    await notify_mentions(
        db,
        project_id=request.project_id,
        actor=current_user,
        text=request.message,
        title=f"{current_user.display_name or current_user.username} 在 LLM 对话中提到了你",
        body=request.message.strip().replace("\n", " ")[:100],
        link=board_link(request.project_id),
    )

    result = await run_agent(
        db=db,
        user=current_user,
        project_id=session.project_id,
        user_message=llm_message,
        history_messages=history,
    )

    unique_actions = await _persist_agent_run(db, session, result, len(history), request.message)

    return LLMAgentChatResponse(
        session_id=session.id,
        message=result.get("message", ""),
        actions=unique_actions,
        pending_question=result.get("pending_question"),
        action_batch_id=result.get("action_batch_id"),
    )


# ---------------------------------------------------------------------------
# Agent chat (SSE streaming)
# ---------------------------------------------------------------------------
_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/agent-chat/stream")
async def agent_chat_stream(
    request: LLMAgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream an agent run as Server-Sent Events.

    Events: status {stage, message} / token {text} / tool_start {name, args} /
    tool_end {name} / done {session_id, message, actions} / error {message}.
    A ``status`` event with stage "thinking" is emitted immediately so the
    client is never fully silent while the first LLM call picks tools.
    Comment lines (": ping") are emitted as a ~15s heartbeat while the run
    is busy without producing tokens.
    """
    try:
        session = await _resolve_chat_session(request, current_user, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    history = await _load_history(session, db)
    llm_message = await _consume_pending_answer_context(session, db, request.message)

    # Same mention fan-out as the buffered endpoint, fired before streaming.
    await notify_mentions(
        db,
        project_id=request.project_id,
        actor=current_user,
        text=request.message,
        title=f"{current_user.display_name or current_user.username} 在 LLM 对话中提到了你",
        body=request.message.strip().replace("\n", " ")[:100],
        link=board_link(request.project_id),
    )

    async def event_source():
        import asyncio

        queue: asyncio.Queue = asyncio.Queue()

        async def produce():
            try:
                async for evt in run_agent_stream(
                    db=db,
                    user=current_user,
                    project_id=session.project_id,
                    user_message=llm_message,
                    history_messages=history,
                ):
                    await queue.put(evt)
            except Exception as e:  # pragma: no cover - defensive
                await queue.put({"type": "result", "result": {
                    "message": f"抱歉，LLM 调用失败：{str(e)}", "actions": [], "messages": [],
                }})
            finally:
                await queue.put(None)

        task = asyncio.create_task(produce())
        try:
            while True:
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                if evt is None:
                    break
                etype = evt.get("type")
                if etype == "status":
                    yield _sse("status", {
                        "stage": evt.get("stage", ""),
                        "message": evt.get("message", ""),
                    })
                elif etype == "token":
                    yield _sse("token", {"text": evt.get("text", "")})
                elif etype == "tool_start":
                    yield _sse("tool_start", {
                        "name": evt.get("name", ""),
                        "args": evt.get("args", {}),
                    })
                elif etype == "tool_end":
                    yield _sse("tool_end", {"name": evt.get("name", "")})
                elif etype == "result":
                    result = evt.get("result") or {}
                    try:
                        actions = await _persist_agent_run(
                            db, session, result, len(history), request.message
                        )
                        await db.commit()
                        yield _sse("done", {
                            "session_id": session.id,
                            "message": result.get("message", ""),
                            "actions": actions,
                            "pending_question": result.get("pending_question"),
                            "action_batch_id": result.get("action_batch_id"),
                        })
                    except Exception as e:
                        yield _sse("error", {"message": f"保存会话失败：{str(e)}"})
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_source(), media_type="text/event-stream", headers=_SSE_HEADERS)
