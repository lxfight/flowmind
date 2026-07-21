from datetime import datetime
from typing import Any
import uuid
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from app.core.config import get_settings
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.models.knowledge import KnowledgeDoc, DocChunk
from app.schemas import TaskCreate, TaskUpdate, TaskMove, TaskCommentCreate, TaskStatusCreate, TaskStatusUpdate
from app.services import task_service
from app.services.rag_service import rag_service
from langchain_openai import ChatOpenAI
from sqlalchemy import func, select

settings = get_settings()


# ---------------------------------------------------------------------------
# Helper: dependencies and role checks from RunnableConfig
# ---------------------------------------------------------------------------
def _get_deps(config: RunnableConfig):
    cfg = config.get("configurable", {})
    db = cfg.get("db")
    user = cfg.get("user")
    project_id = cfg.get("project_id")
    if db is None or user is None or project_id is None:
        raise RuntimeError("Agent 缺少 db/user/project_id 配置")
    return db, user, project_id


def _record_action(config: RunnableConfig, action: dict) -> None:
    cfg = config.get("configurable", {})
    actions = cfg.get("actions")
    if actions is not None:
        actions.append(action)


def _record_pending_question(config: RunnableConfig, question: dict) -> None:
    cfg = config.get("configurable", {})
    pending = cfg.get("pending_question")
    if pending is not None:
        pending.update(question)


def _format_result(ok: bool, message: str = "", action: dict | None = None) -> str:
    import json
    payload = {"ok": ok, "message": message or ("操作成功。" if ok else "操作失败。")}
    if action:
        payload["action"] = action
    return json.dumps(payload, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
@tool
async def get_project_info(config: RunnableConfig) -> str:
    """获取当前项目的整体信息：状态列、成员、最近任务。"""
    db, user, project_id = _get_deps(config)
    try:
        summary = await task_service.get_project_summary(project_id, user, db)
        lines = [
            f"项目：{summary['project_name']}",
            f"描述：{summary['project_description'] or '无'}",
            "状态列：",
            *summary["statuses"],
            "成员：",
            *summary["members"],
            "最近任务：",
            *summary["recent_tasks"],
        ]
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def list_tasks(config: RunnableConfig, status_id: int | None = None, assignee_id: int | None = None) -> str:
    """列出当前项目的任务。"""
    db, user, project_id = _get_deps(config)
    try:
        result = await task_service.list_tasks(project_id, user, db, status_id=status_id, assignee_id=assignee_id, page=1, page_size=100)
        tasks = result.items
        if not tasks:
            return "当前没有符合条件的任务。"
        lines = []
        for t in tasks:
            lines.append(
                f"- [{t.id}] {t.title} (状态id={t.status_id}, 优先级={t.priority}, 完成={t.is_completed}, "
                f"指派={('、'.join(a.display_name or a.username for a in t.assignees)) or '未指派'})"
            )
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def search_tasks(query: str, config: RunnableConfig) -> str:
    """按标题或描述搜索当前项目的任务。"""
    db, user, project_id = _get_deps(config)
    try:
        tasks = await task_service.search_tasks(project_id, user, db, query)
        if not tasks:
            return f"未找到匹配‘{query}’的任务。"
        lines = [f"- [{t.id}] {t.title} (状态id={t.status_id}, 完成={t.is_completed})" for t in tasks]
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def get_task(task_id: int, config: RunnableConfig) -> str:
    """获取单个任务的详细信息。"""
    db, user, project_id = _get_deps(config)
    try:
        t = await task_service.get_task(project_id, task_id, user, db)
        return (
            f"任务 [{t.id}] {t.title}\n"
            f"描述：{t.description or '无'}\n"
            f"状态id：{t.status_id}\n"
            f"优先级：{t.priority}\n"
            f"指派人：{('、'.join(a.display_name or a.username for a in t.assignees)) or '未指派'}\n"
            f"截止日期：{t.due_date}\n"
            f"完成：{t.is_completed}\n"
            f"子任务：{t.subtask_done}/{t.subtask_count}\n"
            f"评论数：{t.comment_count}"
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def get_members(config: RunnableConfig) -> str:
    """获取当前项目的成员列表，用于指派任务。"""
    db, user, project_id = _get_deps(config)
    try:
        members = await task_service.get_members(project_id, user, db)
        if not members:
            return "暂无成员。"
        lines = [f"- {m.display_name or m.username} (user_id={m.user_id}, 角色={m.role})" for m in members]
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def create_task(
    title: str,
    description: str = "",
    status_id: int | None = None,
    priority: int = 0,
    assignee_ids: list[int] | None = None,
    due_date: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """在当前项目创建任务。status_id 必须通过 get_project_info 获取。"""
    db, user, project_id = _get_deps(config)
    if status_id is None:
        return "创建任务必须提供 status_id，请先调用 get_project_info 获取状态列 ID。"
    try:
        data = TaskCreate(title=title, description=description, status_id=status_id, priority=priority)
        if assignee_ids:
            data.assignee_ids = assignee_ids
        if due_date:
            data.due_date = datetime.fromisoformat(due_date)
        t = await task_service.create_task(project_id, data, user, db)
        return _format_result(
            True,
            message=f"已创建任务 [{t.id}] {t.title}。",
            action={"type": "create_task", "task_id": t.id, "title": t.title},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def update_task(
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    status_id: int | None = None,
    assignee_ids: list[int] | None = None,
    priority: int | None = None,
    due_date: str | None = None,
    is_completed: bool | None = None,
    config: RunnableConfig = None,
) -> str:
    """更新任务信息。"""
    db, user, project_id = _get_deps(config)
    try:
        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if description is not None:
            payload["description"] = description
        if status_id is not None:
            payload["status_id"] = status_id
        if assignee_ids is not None:
            payload["assignee_ids"] = assignee_ids
        if priority is not None:
            payload["priority"] = priority
        if due_date is not None:
            payload["due_date"] = datetime.fromisoformat(due_date) if due_date else None
        if is_completed is not None:
            payload["is_completed"] = is_completed
        if not payload:
            return "没有提供任何要更新的字段。"
        data = TaskUpdate(**payload)
        t = await task_service.update_task(project_id, task_id, data, user, db)
        return _format_result(
            True,
            message=f"已更新任务 [{t.id}] {t.title}。",
            action={"type": "update_task", "task_id": t.id, "title": t.title},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def move_task(task_id: int, status_id: int, config: RunnableConfig = None) -> str:
    """将任务移动到指定状态列。status_id 必须通过 get_project_info 获取。"""
    db, user, project_id = _get_deps(config)
    try:
        data = TaskMove(status_id=status_id, order=0)
        t = await task_service.move_task(project_id, task_id, data, user, db)
        return _format_result(
            True,
            message=f"已将任务 [{t.id}] {t.title} 移动到状态 {status_id}。",
            action={"type": "move_task", "task_id": t.id, "status_id": t.status_id, "title": t.title},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def add_comment(task_id: int, content: str, config: RunnableConfig = None) -> str:
    """给任务添加评论。"""
    db, user, project_id = _get_deps(config)
    try:
        await task_service.add_comment(
            project_id, task_id, TaskCommentCreate(content=content), user, db
        )
        return _format_result(
            True,
            message=f"已为任务 [{task_id}] 添加评论。",
            action={"type": "add_comment", "task_id": task_id},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def add_subtask(parent_task_id: int, title: str, config: RunnableConfig = None) -> str:
    """为任务添加子任务。"""
    db, user, project_id = _get_deps(config)
    try:
        t = await task_service.add_subtask(project_id, parent_task_id, title, user, db)
        return _format_result(
            True,
            message=f"已添加子任务 [{t.id}] {t.title}。",
            action={"type": "add_subtask", "task_id": t.id, "parent_task_id": parent_task_id, "title": t.title},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def update_subtask(subtask_id: int, is_completed: bool, config: RunnableConfig = None) -> str:
    """更新子任务完成状态。"""
    db, user, project_id = _get_deps(config)
    try:
        t = await task_service.update_subtask(project_id, subtask_id, is_completed, user, db)
        return _format_result(
            True,
            message=f"已更新子任务 [{t.id}] 完成状态为 {is_completed}。",
            action={"type": "update_subtask", "task_id": t.id, "is_completed": is_completed},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def create_status(name: str, color: str = "#6b7280", is_done: bool = False, config: RunnableConfig = None) -> str:
    """创建新状态列（需要管理员权限）。"""
    db, user, project_id = _get_deps(config)
    try:
        s = await task_service.create_status(project_id, TaskStatusCreate(name=name, color=color, is_done=is_done), user, db)
        return _format_result(
            True,
            message=f"已创建状态列 [{s.id}] {s.name}。",
            action={"type": "create_status", "status_id": s.id, "name": s.name},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def update_status(status_id: int, name: str | None = None, color: str | None = None, is_done: bool | None = None, config: RunnableConfig = None) -> str:
    """修改状态列（需要管理员权限）。"""
    db, user, project_id = _get_deps(config)
    try:
        payload: dict[str, Any] = {}
        if name is not None:
            payload["name"] = name
        if color is not None:
            payload["color"] = color
        if is_done is not None:
            payload["is_done"] = is_done
        if not payload:
            return "没有提供任何要更新的字段。"
        data = TaskStatusUpdate(**payload)
        s = await task_service.update_status(project_id, status_id, data, user, db)
        return _format_result(
            True,
            message=f"已更新状态列 [{s.id}] {s.name}。",
            action={"type": "update_status", "status_id": s.id, "name": s.name},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def delete_status(status_id: int, confirmed: bool = False, config: RunnableConfig = None) -> str:
    """删除状态列（需要管理员权限）。这是破坏性操作：默认 confirmed=False 时不会真正删除，
    只会返回待确认信息；必须先向用户说明影响并获得明确同意后，再以 confirmed=True 调用。"""
    db, user, project_id = _get_deps(config)
    try:
        if not confirmed:
            status = await db.get(TaskStatus, status_id)
            if status is None or status.project_id != project_id:
                return _format_result(False, message=f"状态列 {status_id} 不存在。")
            result = await db.execute(
                select(func.count(Task.id)).where(Task.status_id == status_id)
            )
            task_count = result.scalar() or 0
            return _format_result(
                False,
                message=(
                    f"此操作将删除状态列「{status.name}」（含 {task_count} 个任务），且不可自动恢复。"
                    "请先向用户说明影响并获得明确同意，然后使用 confirmed=true 重新调用本工具。"
                ),
            )
        await task_service.delete_status(project_id, status_id, user, db)
        return _format_result(
            True,
            message=f"已删除状态列 {status_id}。",
            action={"type": "delete_status", "status_id": status_id},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def search_knowledge(query: str, config: RunnableConfig) -> str:
    """在项目知识库中语义检索相关文档片段，返回来源文档与相似度。"""
    db, user, project_id = _get_deps(config)
    try:
        hits = await rag_service.retrieve_context(query, project_id, db, top_k=5)
        if not hits:
            return f"知识库中没有找到与「{query}」相关的内容"
        blocks = []
        for h in hits:
            content = h["content"]
            if len(content) > 300:
                content = content[:300] + "…"
            blocks.append(
                f"《{h['doc_title']}》(相似度 {h['similarity'] * 100:.0f}%)\n{content}"
            )
        return "\n\n".join(blocks)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def list_knowledge_docs(config: RunnableConfig) -> str:
    """列出当前项目知识库中的文档（标题、类型、索引状态、分块数）。"""
    db, user, project_id = _get_deps(config)
    try:
        result = await db.execute(
            select(KnowledgeDoc, func.count(DocChunk.id).label("chunk_count"))
            .outerjoin(DocChunk, DocChunk.doc_id == KnowledgeDoc.id)
            .where(KnowledgeDoc.project_id == project_id)
            .group_by(KnowledgeDoc.id)
            .order_by(KnowledgeDoc.updated_at.desc())
            .limit(50)
        )
        rows = result.all()
        if not rows:
            return "当前项目还没有知识库文档。"
        lines = [
            f"- [id={doc.id}] {doc.title} (类型={doc.file_type}, 状态={doc.status}, "
            f"分块数={chunk_count}, 更新于={doc.updated_at})"
            for doc, chunk_count in rows
        ]
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def get_doc_content(
    doc_id: int | None = None,
    title: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """按 doc_id 或标题获取知识库文档的完整内容（超长会截断）。"""
    db, user, project_id = _get_deps(config)
    if doc_id is None and not title:
        return "请提供 doc_id 或文档标题。"
    try:
        stmt = select(KnowledgeDoc).where(KnowledgeDoc.project_id == project_id)
        if doc_id is not None:
            stmt = stmt.where(KnowledgeDoc.id == doc_id)
        else:
            stmt = stmt.where(KnowledgeDoc.title == title)
        result = await db.execute(stmt)
        doc = result.scalars().first()
        if doc is None:
            return f"未找到文档（doc_id={doc_id}, title={title}）。请先用 list_knowledge_docs 确认。"
        content = doc.content or ""
        truncated = len(content) > 4000
        if truncated:
            content = content[:4000]
        header = f"《{doc.title}》 (id={doc.id}, 类型={doc.file_type}, 状态={doc.status})"
        note = "\n…（内容过长，已截断至 4000 字符）" if truncated else ""
        return f"{header}\n{content}{note}"
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def ask_user(question: str, options: list[str] | None = None, config: RunnableConfig = None) -> str:
    """当关键信息缺失且无法从上下文或知识库推断时，向用户提问澄清。
    可附 2-4 个 options 供用户快速选择。调用后必须立即结束本轮回复。"""
    _record_pending_question(config, {"question": question, "options": options or None})
    return "已向用户提问，请结束本轮回复，不要自行假设答案。"


# ---------------------------------------------------------------------------
# Agent runner
# ---------------------------------------------------------------------------
tools = [
    get_project_info,
    list_tasks,
    search_tasks,
    get_task,
    get_members,
    create_task,
    update_task,
    move_task,
    add_comment,
    add_subtask,
    update_subtask,
    create_status,
    update_status,
    delete_status,
    search_knowledge,
    list_knowledge_docs,
    get_doc_content,
    ask_user,
]


def _build_system_prompt(project_summary: dict) -> str:
    return (
        "你是 FlowMind 智能助手，帮助用户管理任务和项目。你只能通过提供的工具操作当前项目，"
        "禁止编造 ID。所有 task_id、status_id、assignee_id 必须从工具查询结果中获取。\n\n"
        f"当前项目：{project_summary['project_name']}\n"
        f"描述：{project_summary['project_description'] or '无'}\n\n"
        "可用工具说明：\n"
        "- 查询：get_project_info / list_tasks / search_tasks / get_task / get_members\n"
        "- 操作：create_task / update_task / move_task / add_comment / add_subtask / update_subtask\n"
        "- 管理：create_status / update_status / delete_status（需要管理员权限）\n"
        "- 知识库：search_knowledge / list_knowledge_docs / get_doc_content\n"
        "- 提问：ask_user（向用户澄清关键信息）\n\n"
        "知识库使用规则：\n"
        "- 项目有知识库文档时，创建、拆分或规划任务前先用 search_knowledge 检索相关背景。\n"
        "- 引用知识库信息时，在回复中注明来源文档名。\n"
        "- search_knowledge 返回“没有找到”时，不得编造知识库内容。\n"
        "- 不确定项目约定或背景时，优先查知识库，再决定是否向用户提问。\n\n"
        "澄清提问规则：\n"
        "- 当用户需求的关键信息缺失时——例如建看板/列但列名或流程不明、创建任务但指派人/"
        "截止日期/优先级无法从上下文或知识库推断——必须先 search_knowledge 查证；"
        "知识库也没有时，调用 ask_user 提问，可附 2-4 个 options 供快速选择。\n"
        "- 能合理推断的直接执行，并在回复中说明所做的假设。\n"
        "- 调用 ask_user 后立即结束本轮回复：不要再调用其他工具，也不要自行假设或编造答案。\n\n"
        "破坏性操作确认规则：\n"
        "- delete_status 是破坏性操作。首次调用不要传 confirmed；工具会返回待确认信息。\n"
        "- 随后必须向用户说明将删除的状态列及其影响并获得明确同意（可直接在回复中询问），"
        "用户同意后再以 confirmed=true 调用 delete_status 完成删除。\n\n"
        "工作方式：先调用查询工具确认事实，再执行操作。"
        "用中文回答，保持专业友好。"
    )


def _convert_db_messages_to_lc(messages: list[dict]) -> list:
    """Convert persisted message dicts to LangChain message objects."""
    lc_messages = []
    for m in messages:
        role = m["role"]
        content = m.get("content") or ""
        if role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            tool_calls = m.get("tool_calls") or []
            lc_tool_calls = [
                {
                    "id": tc.get("id", f"call_{i}"),
                    "name": tc["tool"],
                    "args": tc.get("arguments", {}),
                }
                for i, tc in enumerate(tool_calls)
            ]
            lc_messages.append(AIMessage(content=content, tool_calls=lc_tool_calls))
        elif role == "tool":
            results = m.get("tool_results") or []
            for r in results:
                lc_messages.append(
                    ToolMessage(
                        content=r.get("message", ""),
                        tool_call_id=r.get("tool_call_id", ""),
                        name=r.get("tool", ""),
                    )
                )
    return lc_messages


def _content_to_text(content) -> str:
    """Normalize LangChain message content (str or block list) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return ""


async def _build_agent_run(db, user: User, project_id: int, user_message: str,
                           history_messages: list[dict] | None):
    """Shared setup for run_agent / run_agent_stream.

    Returns (agent, input_messages, config, actions, pending_question, action_batch_id)
    or None when LLM is not configured.
    """
    if not settings.llm_api_key:
        return None

    project_summary = await task_service.get_project_summary(project_id, user, db)
    system_prompt = _build_system_prompt(project_summary)

    llm = ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=0.2,
        max_tokens=4096,
        streaming=True,
    )

    agent = create_react_agent(llm, tools, prompt=SystemMessage(content=system_prompt))

    actions: list[dict] = []
    pending_question: dict = {}
    config: RunnableConfig = {
        "configurable": {
            "db": db,
            "user": user,
            "project_id": project_id,
            "actions": actions,
            "pending_question": pending_question,
        }
    }

    history = _convert_db_messages_to_lc(history_messages or [])
    input_messages = history + [HumanMessage(content=user_message)]
    # One batch id per run; mutations stamp it on their ActivityLog rows so
    # the whole run can be undone as a unit.
    action_batch_id = uuid.uuid4().hex
    return agent, input_messages, config, actions, pending_question, action_batch_id


def _finalize_result(all_messages: list, actions: list[dict], pending_question: dict | None = None,
                     action_batch_id: str | None = None) -> dict:
    final_message = all_messages[-1]
    return {
        "message": _content_to_text(final_message.content),
        "actions": actions,
        "messages": all_messages,
        "pending_question": pending_question or None,
        "action_batch_id": action_batch_id,
    }


def _error_result(message: str) -> dict:
    return {"message": message, "actions": [], "messages": [], "pending_question": None, "action_batch_id": None}


async def run_agent(
    db,
    user: User,
    project_id: int,
    user_message: str,
    history_messages: list[dict] | None = None,
) -> dict:
    """Run the LangGraph ReAct agent and return assistant message + actions + all messages."""
    built = await _build_agent_run(db, user, project_id, user_message, history_messages)
    if built is None:
        return _error_result("LLM 未配置，请在环境变量中设置 LLM_API_KEY。")
    agent, input_messages, config, actions, pending_question, action_batch_id = built

    token = task_service.set_agent_batch(action_batch_id)
    try:
        result = await agent.ainvoke({"messages": input_messages}, config=config)
    except Exception as e:
        return _error_result(f"抱歉，LLM 调用失败：{str(e)}")
    finally:
        task_service.reset_agent_batch(token)

    return _finalize_result(result["messages"], actions, pending_question, action_batch_id)


async def run_agent_stream(
    db,
    user: User,
    project_id: int,
    user_message: str,
    history_messages: list[dict] | None = None,
):
    """Async generator streaming the agent run.

    Yields dict events:
      {"type": "token", "text": str}
      {"type": "tool_start", "name": str, "args": dict}
      {"type": "tool_end", "name": str}
      {"type": "result", "result": <same dict shape as run_agent>}
    """
    built = await _build_agent_run(db, user, project_id, user_message, history_messages)
    if built is None:
        yield {
            "type": "result",
            "result": _error_result("LLM 未配置，请在环境变量中设置 LLM_API_KEY。"),
        }
        return
    agent, input_messages, config, actions, pending_question, action_batch_id = built

    final_messages: list | None = None
    batch_token = task_service.set_agent_batch(action_batch_id)
    try:
        async for event in agent.astream_events(
            {"messages": input_messages}, config=config, version="v2"
        ):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk is not None:
                    text = _content_to_text(getattr(chunk, "content", ""))
                    if text:
                        yield {"type": "token", "text": text}
            elif kind == "on_tool_start":
                name = event.get("name", "")
                args = event.get("data", {}).get("input")
                yield {
                    "type": "tool_start",
                    "name": name,
                    "args": args if isinstance(args, dict) else {},
                }
            elif kind == "on_tool_end":
                yield {"type": "tool_end", "name": event.get("name", "")}
            elif kind == "on_chain_end":
                output = event.get("data", {}).get("output")
                if isinstance(output, dict) and "messages" in output:
                    final_messages = output["messages"]
    except Exception as e:
        yield {
            "type": "result",
            "result": _error_result(f"抱歉，LLM 调用失败：{str(e)}"),
        }
        return
    finally:
        task_service.reset_agent_batch(batch_token)

    if not final_messages:
        yield {
            "type": "result",
            "result": _error_result("抱歉，LLM 调用失败：未收到响应。"),
        }
        return

    yield {"type": "result", "result": _finalize_result(final_messages, actions, pending_question, action_batch_id)}
