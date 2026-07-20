from datetime import datetime, timezone, timedelta
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.security import get_current_user
from app.api.permissions import ensure_project_member
from app.models.user import User
from app.models.task import Task, TaskStatus
from app.models.project import Project
from app.models.llm_chat import LLMChatSession, LLMChatMessage
from app.schemas import (
    LLMChatRequest,
    LLMChatResponse,
    LLMTaskGenerate,
    LLMChatSessionCreate,
    LLMChatSessionUpdate,
    LLMChatSessionOut,
    LLMChatSessionDetailOut,
    LLMChatMessageOut,
    LLMAgentChatRequest,
    LLMAgentChatResponse,
)
from app.services.llm_service import llm_service
from app.services.rag_service import rag_service
from app.services.agent_service import run_agent
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

router = APIRouter(prefix="/api/llm", tags=["llm"])


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
        except Exception:
            pass

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
        select(Task).where(Task.project_id == request.project_id).limit(20)
    )
    existing_tasks = result.scalars().all()
    task_context = f"当前项目共有 {len(existing_tasks)} 个任务"

    project_context = f"项目状态列: {', '.join(status_names)}\n{task_context}"

    try:
        generated = await llm_service.generate_tasks(request.instruction, project_context)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"任务生成失败: {str(e)}")

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
    content = f"{task_title}\n{task_description}".strip()

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

    # Get all tasks with status names
    result = await db.execute(
        select(Task, TaskStatus.name)
        .join(TaskStatus, Task.status_id == TaskStatus.id)
        .where(Task.project_id == project_id)
        .order_by(TaskStatus.order, Task.order)
    )
    rows = result.all()

    # Get activity logs from the past 7 days
    from app.models.activity import ActivityLog
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    result = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.project_id == project_id,
            ActivityLog.created_at >= week_ago,
        )
        .order_by(ActivityLog.created_at.desc())
    )
    logs = result.scalars().all()

    # Build task summary
    status_counts: dict[str, int] = {}
    task_details: list[str] = []
    for t, sname in rows:
        status_counts[sname] = status_counts.get(sname, 0) + 1
        task_details.append(f"- [{sname}] {t.title} (优先级:{t.priority})")

    tasks_data = f"总计 {len(rows)} 个任务\n"
    for sname, count in status_counts.items():
        tasks_data += f"  {sname}: {count} 个\n"
    tasks_data += "\n任务列表:\n" + "\n".join(task_details) if task_details else "暂无任务"

    log_data = ""
    if logs:
        log_data = "\n近7天动态:\n" + "\n".join(f"- {l.summary}" for l in logs[:20])

    report = await llm_service.generate_report(
        tasks_data + log_data, project.name
    )

    return {"report": report, "generated_at": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------
@router.get("/sessions", response_model=list[LLMChatSessionOut])
async def list_sessions(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    result = await db.execute(
        select(LLMChatSession)
        .where(
            LLMChatSession.project_id == project_id,
            LLMChatSession.user_id == current_user.id,
        )
        .order_by(LLMChatSession.updated_at.desc())
    )
    return result.scalars().all()


@router.post("/sessions", response_model=LLMChatSessionOut, status_code=201)
async def create_session(
    data: LLMChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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
        raise HTTPException(status_code=403, detail="无权访问此会话")
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
        raise HTTPException(status_code=403, detail="无权修改此会话")
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
        raise HTTPException(status_code=403, detail="无权删除此会话")
    await db.delete(session)
    return {"message": "会话已删除"}


# ---------------------------------------------------------------------------
# Agent chat
# ---------------------------------------------------------------------------
@router.post("/agent-chat", response_model=LLMAgentChatResponse)
async def agent_chat(
    request: LLMAgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(request.project_id, current_user, db)

    session: LLMChatSession | None = None
    if request.session_id:
        result = await db.execute(
            select(LLMChatSession).where(LLMChatSession.id == request.session_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        if session.user_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="无权访问此会话")
        if session.project_id != request.project_id:
            raise HTTPException(status_code=403, detail="会话不属于该项目")
    else:
        title = request.message.strip()[:20] or "新会话"
        session = LLMChatSession(
            user_id=current_user.id,
            project_id=request.project_id,
            title=title,
        )
        db.add(session)
        await db.flush()
        await db.refresh(session)

    # Load history as plain dicts
    result = await db.execute(
        select(LLMChatMessage)
        .where(LLMChatMessage.session_id == session.id)
        .order_by(LLMChatMessage.ordinal)
    )
    history = [
        {
            "role": m.role,
            "content": m.content,
            "tool_calls": m.tool_calls,
            "tool_results": m.tool_results,
        }
        for m in result.scalars().all()
    ]

    result = await run_agent(
        db=db,
        user=current_user,
        project_id=request.project_id,
        user_message=request.message,
        history_messages=history,
    )

    # Persist only new messages returned by the agent run (skip replayed history)
    max_ordinal_result = await db.execute(
        select(func.max(LLMChatMessage.ordinal)).where(LLMChatMessage.session_id == session.id)
    )
    next_ordinal = (max_ordinal_result.scalar() or 0) + 1

    persisted_messages = []
    returned_messages = result.get("messages", [])
    new_messages = returned_messages[len(history):]
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

    session.updated_at = datetime.now(timezone.utc)
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

    return LLMAgentChatResponse(
        session_id=session.id,
        message=result.get("message", ""),
        actions=unique_actions,
    )
