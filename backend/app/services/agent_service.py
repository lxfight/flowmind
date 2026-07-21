import uuid
from datetime import datetime
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from sqlalchemy import func, select

from app.models.knowledge import DocChunk, KnowledgeDoc
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.schemas import TaskCommentCreate, TaskCreate, TaskMove, TaskStatusCreate, TaskStatusUpdate, TaskUpdate
from app.services import task_service
from app.services.config_service import config_service
from app.services.rag_service import rag_service


# ---------------------------------------------------------------------------
# Helper: dependencies and role checks from RunnableConfig
# ---------------------------------------------------------------------------
def _get_ctx(config: RunnableConfig):
    """Return (db, user, project_id, project_ids, project_names).

    ``project_id`` is the single-project context of the session (None for
    cross-project sessions); ``project_ids`` is the full in-scope set the
    tools may touch. Backward compatible with configs that only carry
    ``project_id`` (scope degrades to that one project).
    """
    cfg = config.get("configurable", {})
    db = cfg.get("db")
    user = cfg.get("user")
    project_id = cfg.get("project_id")
    project_ids = cfg.get("project_ids")
    if project_ids is None:
        project_ids = [project_id] if project_id is not None else []
    project_names = cfg.get("project_names") or {}
    if db is None or user is None or not project_ids:
        raise RuntimeError("Agent 缺少 db/user/project_ids 配置")
    return db, user, project_id, project_ids, project_names


def _proj_label(project_names: dict, pid: int | None) -> str:
    """Human label like 【项目A】 used to annotate cross-project results."""
    return f"【{project_names.get(pid, f'项目{pid}')}】"


async def _find_task_project(db, task_id: int, project_ids: list[int]) -> int | None:
    """Project that owns the task, or None when it is outside the scope."""
    result = await db.execute(select(Task.project_id).where(Task.id == task_id))
    pid = result.scalar_one_or_none()
    return pid if pid in project_ids else None


async def _find_status_project(db, status_id: int, project_ids: list[int]) -> int | None:
    """Project that owns the status column, or None when outside the scope."""
    result = await db.execute(select(TaskStatus.project_id).where(TaskStatus.id == status_id))
    pid = result.scalar_one_or_none()
    return pid if pid in project_ids else None


def _resolve_target_project(config: RunnableConfig, provided: int | None):
    """Pick the project a creating write (create_task/create_status) targets.

    Returns (project_id, None) on success; (None, message) when the provided
    id is out of scope; (None, "ASK") when the context is cross-project and
    no target was given — a pending question is recorded so the run asks the
    user which project to use instead of guessing.
    """
    cfg = config.get("configurable", {})
    ctx_pid = cfg.get("project_id")
    project_ids = cfg.get("project_ids") or ([ctx_pid] if ctx_pid is not None else [])
    names = cfg.get("project_names") or {}
    if provided is not None:
        if provided not in project_ids:
            return None, f"项目 id={provided} 不在你当前可访问的项目范围内，请从用户参与的项目中选择。"
        return provided, None
    if ctx_pid is not None:
        return ctx_pid, None
    options = [names.get(pid, f"项目{pid}") for pid in project_ids][:4]
    _record_pending_question(config, {
        "question": "这次操作要在哪个项目中进行？",
        "options": options or None,
    })
    return None, "ASK"


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
async def get_project_info(config: RunnableConfig, project_id: int | None = None) -> str:
    """获取某个项目的整体信息：状态列、成员、最近任务。

    单项目会话中无需参数；跨项目会话中必须用 project_id 指定项目。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    target = project_id if project_id is not None else ctx_pid
    if target is None:
        listing = "\n".join(f"- [id={pid}] {names.get(pid, f'项目{pid}')}" for pid in project_ids)
        return "当前是跨项目会话，请用 project_id 参数指定要查看的项目：\n" + listing
    if target not in project_ids:
        return _format_result(False, message=f"项目 id={target} 不在你可访问的项目范围内。")
    try:
        summary = await task_service.get_project_summary(target, user, db)
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
async def list_tasks(config: RunnableConfig, status_id: int | None = None, assignee_id: int | None = None,
                     project_id: int | None = None) -> str:
    """列出项目任务。跨项目会话中不传 project_id 时列出所有项目的任务。"""
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    targets = [project_id] if project_id is not None else ([ctx_pid] if ctx_pid is not None else project_ids)
    for t in targets:
        if t not in project_ids:
            return _format_result(False, message=f"项目 id={t} 不在你可访问的项目范围内。")
    try:
        sections = []
        labeled = len(targets) > 1
        for pid in targets:
            result = await task_service.list_tasks(
                pid, user, db, status_id=status_id, assignee_id=assignee_id, page=1, page_size=100
            )
            tasks = result.items
            lines = []
            for t in tasks:
                lines.append(
                    f"- [{t.id}] {t.title} (状态id={t.status_id}, 优先级={t.priority}, 完成={t.is_completed}, "
                    f"指派={('、'.join(a.display_name or a.username for a in t.assignees)) or '未指派'})"
                )
            if labeled:
                sections.append(f"{_proj_label(names, pid)}\n" + ("\n".join(lines) if lines else "（无任务）"))
            else:
                sections.extend(lines)
        if not any(s for s in sections):
            return "当前没有符合条件的任务。"
        return "\n".join(sections)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def search_tasks(query: str, config: RunnableConfig, project_id: int | None = None) -> str:
    """按标题或描述搜索任务。跨项目会话中不传 project_id 时搜索所有项目。"""
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    targets = [project_id] if project_id is not None else ([ctx_pid] if ctx_pid is not None else project_ids)
    for t in targets:
        if t not in project_ids:
            return _format_result(False, message=f"项目 id={t} 不在你可访问的项目范围内。")
    try:
        labeled = len(targets) > 1
        lines = []
        for pid in targets:
            tasks = await task_service.search_tasks(pid, user, db, query)
            for t in tasks:
                prefix = f"{_proj_label(names, pid)} " if labeled else ""
                lines.append(f"{prefix}- [{t.id}] {t.title} (状态id={t.status_id}, 完成={t.is_completed})")
        if not lines:
            return f"未找到匹配‘{query}’的任务。"
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def get_task(task_id: int, config: RunnableConfig) -> str:
    """获取单个任务的详细信息（跨项目会话中按 id 自动定位所属项目）。"""
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={task_id}（不属于你参与的项目）。")
    try:
        t = await task_service.get_task(pid, task_id, user, db)
        header = f"{_proj_label(names, pid)} " if ctx_pid is None else ""
        return (
            f"{header}任务 [{t.id}] {t.title}\n"
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
async def get_members(config: RunnableConfig, project_id: int | None = None) -> str:
    """获取项目成员列表，用于指派任务。跨项目会话中需用 project_id 指定项目。"""
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    target = project_id if project_id is not None else ctx_pid
    if target is None:
        listing = "\n".join(f"- [id={pid}] {names.get(pid, f'项目{pid}')}" for pid in project_ids)
        return "当前是跨项目会话，请用 project_id 参数指定要查看成员的项目：\n" + listing
    if target not in project_ids:
        return _format_result(False, message=f"项目 id={target} 不在你可访问的项目范围内。")
    try:
        members = await task_service.get_members(target, user, db)
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
    project_id: int | None = None,
    config: RunnableConfig = None,
) -> str:
    """创建任务。status_id 必须通过 get_project_info 获取。

    跨项目会话中：用户已指明项目时传 project_id；不传则会向用户追问目标项目。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    if status_id is None:
        return "创建任务必须提供 status_id，请先调用 get_project_info 获取状态列 ID。"
    target, err = _resolve_target_project(config, project_id)
    if target is None:
        if err == "ASK":
            return "目标项目不明确，已向用户提问要在哪个项目中创建，请立即结束本轮回复。"
        return _format_result(False, message=err)
    try:
        data = TaskCreate(title=title, description=description, status_id=status_id, priority=priority)
        if assignee_ids:
            data.assignee_ids = assignee_ids
        if due_date:
            data.due_date = datetime.fromisoformat(due_date)
        t = await task_service.create_task(target, data, user, db)
        label = f"{_proj_label(names, target)}" if ctx_pid is None else ""
        return _format_result(
            True,
            message=f"已在{label}创建任务 [{t.id}] {t.title}。",
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
    """更新任务信息（跨项目会话中按 task_id 自动定位所属项目）。"""
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={task_id}（不属于你参与的项目）。")
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
        t = await task_service.update_task(pid, task_id, data, user, db)
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
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={task_id}（不属于你参与的项目）。")
    try:
        data = TaskMove(status_id=status_id, order=0)
        t = await task_service.move_task(pid, task_id, data, user, db)
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
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={task_id}（不属于你参与的项目）。")
    try:
        await task_service.add_comment(
            pid, task_id, TaskCommentCreate(content=content), user, db
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
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, parent_task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={parent_task_id}（不属于你参与的项目）。")
    try:
        t = await task_service.add_subtask(pid, parent_task_id, title, user, db)
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
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, subtask_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到子任务 id={subtask_id}（不属于你参与的项目）。")
    try:
        t = await task_service.update_subtask(pid, subtask_id, is_completed, user, db)
        return _format_result(
            True,
            message=f"已更新子任务 [{t.id}] 完成状态为 {is_completed}。",
            action={"type": "update_subtask", "task_id": t.id, "is_completed": is_completed},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def create_status(name: str, color: str = "#6b7280", is_done: bool = False,
                        project_id: int | None = None, config: RunnableConfig = None) -> str:
    """创建新状态列（需要管理员权限）。

    跨项目会话中：用户已指明项目时传 project_id；不传则会向用户追问目标项目。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    target, err = _resolve_target_project(config, project_id)
    if target is None:
        if err == "ASK":
            return "目标项目不明确，已向用户提问要在哪个项目中创建，请立即结束本轮回复。"
        return _format_result(False, message=err)
    try:
        s = await task_service.create_status(
            target, TaskStatusCreate(name=name, color=color, is_done=is_done), user, db
        )
        label = f"{_proj_label(names, target)}" if ctx_pid is None else ""
        return _format_result(
            True,
            message=f"已在{label}创建状态列 [{s.id}] {s.name}。",
            action={"type": "create_status", "status_id": s.id, "name": s.name},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def update_status(
    status_id: int,
    name: str | None = None,
    color: str | None = None,
    is_done: bool | None = None,
    config: RunnableConfig = None,
) -> str:
    """修改状态列（需要管理员权限）。"""
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_status_project(db, status_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到状态列 id={status_id}（不属于你参与的项目）。")
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
        s = await task_service.update_status(pid, status_id, data, user, db)
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
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_status_project(db, status_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"状态列 {status_id} 不存在（或不属于你参与的项目）。")
    try:
        if not confirmed:
            status = await db.get(TaskStatus, status_id)
            if status is None or status.project_id != pid:
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
        await task_service.delete_status(pid, status_id, user, db)
        return _format_result(
            True,
            message=f"已删除状态列 {status_id}。",
            action={"type": "delete_status", "status_id": status_id},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def search_knowledge(query: str, config: RunnableConfig) -> str:
    """在知识库中语义检索相关文档片段，返回来源文档与相似度。

    跨项目会话中覆盖用户参与的所有项目，结果标注来源项目。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    try:
        scope = ctx_pid if ctx_pid is not None else project_ids
        hits = await rag_service.retrieve_context(query, scope, db, top_k=5)
        if not hits:
            return f"知识库中没有找到与「{query}」相关的内容"
        labeled = ctx_pid is None
        blocks = []
        for h in hits:
            content = h["content"]
            if len(content) > 300:
                content = content[:300] + "…"
            score_parts = []
            if h.get("vector_score") is not None:
                score_parts.append(f"向量 {h['vector_score'] * 100:.0f}%")
            score_parts.append(f"关键词 {h.get('keyword_score', 0.0) * 100:.0f}%")
            label = f"{_proj_label(names, h.get('project_id'))}" if labeled else ""
            blocks.append(
                f"{label}《{h['doc_title']}》({' / '.join(score_parts)})\n{content}"
            )
        return "\n\n".join(blocks)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def list_knowledge_docs(config: RunnableConfig) -> str:
    """列出知识库文档（标题、类型、索引状态、分块数、内容长度）。

    跨项目会话中覆盖用户参与的所有项目，每条标注来源项目。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    try:
        project_filter = (
            KnowledgeDoc.project_id == ctx_pid
            if ctx_pid is not None
            else KnowledgeDoc.project_id.in_(project_ids)
        )
        result = await db.execute(
            select(
                KnowledgeDoc,
                func.count(DocChunk.id).label("chunk_count"),
                func.length(KnowledgeDoc.content).label("content_length"),
            )
            .outerjoin(DocChunk, DocChunk.doc_id == KnowledgeDoc.id)
            .where(project_filter)
            .group_by(KnowledgeDoc.id)
            .order_by(KnowledgeDoc.updated_at.desc())
            .limit(50)
        )
        rows = result.all()
        if not rows:
            return "当前还没有知识库文档。" if ctx_pid is None else "当前项目还没有知识库文档。"
        labeled = ctx_pid is None
        lines = []
        for doc, chunk_count, content_length in rows:
            label = f"{_proj_label(names, doc.project_id)} " if labeled else ""
            lines.append(
                f"{label}- [id={doc.id}] {doc.title} (类型={doc.file_type}, 状态={doc.status}, "
                f"分块数={chunk_count}, 内容长度={content_length or 0} 字符, 更新于={doc.updated_at})"
            )
        return "\n".join(lines)
    except Exception as e:
        return _format_result(False, message=str(e))


# read_knowledge_doc pagination defaults: sized to sit comfortably in the
# model context window while leaving room for the conversation.
READ_DOC_DEFAULT_LIMIT = 10000
READ_DOC_MAX_LIMIT = 20000


@tool
async def read_knowledge_doc(
    doc_id: int,
    offset: int = 0,
    limit: int = READ_DOC_DEFAULT_LIMIT,
    config: RunnableConfig = None,
) -> str:
    """通读知识库文档全文（按字符分页读取）。

    用于需要基于完整文档内容工作的场景——例如通读整份方案文档后创建
    详细的看板任务计划。按问题检索相关片段请改用 search_knowledge。
    长文档一次只返回一页（默认 10000 字符），返回头会标明全文总长度、
    当前区间与下一页 offset，可多次调用翻页直到读完。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    try:
        project_filter = (
            KnowledgeDoc.project_id == ctx_pid
            if ctx_pid is not None
            else KnowledgeDoc.project_id.in_(project_ids)
        )
        result = await db.execute(
            select(KnowledgeDoc).where(
                KnowledgeDoc.id == doc_id,
                project_filter,
            )
        )
        doc = result.scalar_one_or_none()
        if doc is None:
            return (
                f"未找到文档 id={doc_id}（不存在或不属于你参与的项目）。"
                "请先用 list_knowledge_docs 确认文档 id。"
            )

        labeled = ctx_pid is None
        label = f"{_proj_label(names, doc.project_id)}" if labeled else ""
        content = doc.content or ""
        total = len(content)
        if total == 0:
            detail = f"，错误={doc.error_message}" if doc.error_message else ""
            return (
                f"{label}《{doc.title}》(id={doc.id}) 没有可读内容（状态={doc.status}{detail}）。"
                "若状态为 failed 请先重建索引；若仍在 indexing/parsing 请稍后再试。"
            )

        offset = max(0, offset)
        limit = max(1, min(limit, READ_DOC_MAX_LIMIT))
        if offset >= total:
            return (
                f"{label}《{doc.title}》(id={doc.id}) 全文共 {total} 字符，"
                f"offset={offset} 超出范围（有效起始 0，最大 {total - 1}），已到末尾。"
            )

        end = min(offset + limit, total)
        page = content[offset:end]
        if end < total:
            header = (
                f"{label}《{doc.title}》(id={doc.id}, 全文 {total} 字符, "
                f"当前 {offset}-{end}, 后续还有内容，下一页 offset={end})"
            )
        else:
            header = f"{label}《{doc.title}》(id={doc.id}, 全文 {total} 字符, 当前 {offset}-{end}, 已到末尾)"
        return f"{header}\n{page}"
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def get_doc_content(
    doc_id: int | None = None,
    title: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """按 doc_id 或标题获取知识库文档的完整内容（超长会截断）。"""
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    if doc_id is None and not title:
        return "请提供 doc_id 或文档标题。"
    try:
        project_filter = (
            KnowledgeDoc.project_id == ctx_pid
            if ctx_pid is not None
            else KnowledgeDoc.project_id.in_(project_ids)
        )
        stmt = select(KnowledgeDoc).where(project_filter)
        stmt = stmt.where(KnowledgeDoc.id == doc_id) if doc_id is not None else stmt.where(KnowledgeDoc.title == title)
        result = await db.execute(stmt)
        doc = result.scalars().first()
        if doc is None:
            return f"未找到文档（doc_id={doc_id}, title={title}）。请先用 list_knowledge_docs 确认。"
        label = f"{_proj_label(names, doc.project_id)}" if ctx_pid is None else ""
        content = doc.content or ""
        truncated = len(content) > 4000
        if truncated:
            content = content[:4000]
        header = f"{label}《{doc.title}》 (id={doc.id}, 类型={doc.file_type}, 状态={doc.status})"
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
    read_knowledge_doc,
    get_doc_content,
    ask_user,
]


_SHARED_RULES = (
    "知识库使用规则：\n"
    "- 项目有知识库文档时，创建、拆分或规划任务前先用 search_knowledge 检索相关背景。\n"
    "- search_knowledge 用于按问题找相关片段；需要基于某份文档的完整内容工作时"
    "（例如通读整份方案后创建详细任务计划），先用 list_knowledge_docs 找到文档，"
    "再用 read_knowledge_doc 分页通读全文（长文档按返回的下一页 offset 多次调用）。\n"
    "- 引用知识库信息时，在回复中注明来源文档名（跨项目时同时注明项目名）。\n"
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
        "- 知识库：search_knowledge / list_knowledge_docs / read_knowledge_doc / get_doc_content\n"
        "- 提问：ask_user（向用户澄清关键信息）\n\n"
        + _SHARED_RULES
    )


def _build_cross_project_prompt(project_names: dict[int, str]) -> str:
    listing = "\n".join(f"- [id={pid}] {name}" for pid, name in project_names.items())
    return (
        "你是 FlowMind 智能助手，当前处于跨项目模式：用户同时参与多个项目，"
        "你可以跨这些项目查询和操作。禁止编造 ID，所有 id 必须来自工具查询结果。\n\n"
        f"用户参与的项目：\n{listing}\n\n"
        "跨项目规则：\n"
        "- 查询类工具（list_tasks / search_tasks / search_knowledge / list_knowledge_docs）"
        "默认覆盖以上所有项目，结果会标注来源项目；回答时注明信息来自哪个项目。\n"
        "- get_project_info / get_members 需要用 project_id 参数指定项目。\n"
        "- get_task / read_knowledge_doc / get_doc_content 以及按 task_id 定位的更新/移动/"
        "评论/子任务操作会自动解析所属项目（仅限以上项目）。\n"
        "- 创建类写操作（create_task / create_status）必须明确目标项目：用户已指明项目时"
        "用 project_id 参数传入；用户未指明时直接调用工具（会触发向用户提问），"
        "绝不自行假设默认项目。\n\n"
        "可用工具说明：\n"
        "- 查询：get_project_info / list_tasks / search_tasks / get_task / get_members\n"
        "- 操作：create_task / update_task / move_task / add_comment / add_subtask / update_subtask\n"
        "- 管理：create_status / update_status / delete_status（需要管理员权限）\n"
        "- 知识库：search_knowledge / list_knowledge_docs / read_knowledge_doc / get_doc_content\n"
        "- 提问：ask_user（向用户澄清关键信息）\n\n"
        + _SHARED_RULES
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


async def get_user_project_scope(db, user: User) -> tuple[list[int], dict[int, str]]:
    """Ids + names of every project the user is a member of.

    Resolved fresh on every agent run, so a user removed from a project
    immediately loses access to it — including in older cross-project
    sessions. Owners are members too (project creation inserts the owner
    ProjectMember row).
    """
    result = await db.execute(
        select(Project.id, Project.name)
        .join(ProjectMember)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.id)
    )
    rows = result.all()
    return [pid for pid, _ in rows], {pid: name for pid, name in rows}


async def _build_agent_run(db, user: User, project_id: int | None, user_message: str,
                           history_messages: list[dict] | None):
    """Shared setup for run_agent / run_agent_stream.

    ``project_id=None`` means a cross-project run scoped to every project
    the user is a member of. Returns
    (agent, input_messages, config, actions, pending_question, action_batch_id),
    None when LLM is not configured, or an error-result dict when the
    cross-project scope is empty.
    """
    api_key = await config_service.get("llm_api_key")
    if not api_key:
        return None

    if project_id is not None:
        project_summary = await task_service.get_project_summary(project_id, user, db)
        project_ids = [project_id]
        project_names = {project_id: project_summary["project_name"]}
        system_prompt = _build_system_prompt(project_summary)
    else:
        project_ids, project_names = await get_user_project_scope(db, user)
        if not project_ids:
            return _error_result("你还没有参与任何项目，无法使用跨项目助手。请先创建或加入一个项目。")
        system_prompt = _build_cross_project_prompt(project_names)

    llm = ChatOpenAI(
        base_url=await config_service.get("llm_base_url"),
        api_key=api_key,
        model=await config_service.get("llm_model"),
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
            "project_ids": project_ids,
            "project_names": project_names,
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
    project_id: int | None,
    user_message: str,
    history_messages: list[dict] | None = None,
) -> dict:
    """Run the LangGraph ReAct agent and return assistant message + actions + all messages."""
    built = await _build_agent_run(db, user, project_id, user_message, history_messages)
    if built is None:
        return _error_result("LLM 未配置，请在环境变量中设置 LLM_API_KEY。")
    if isinstance(built, dict):
        return built
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
    project_id: int | None,
    user_message: str,
    history_messages: list[dict] | None = None,
):
    """Async generator streaming the agent run.

    Yields dict events:
      {"type": "status", "stage": str, "message": str}
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
    if isinstance(built, dict):
        yield {"type": "result", "result": built}
        return
    agent, input_messages, config, actions, pending_question, action_batch_id = built

    # Emit an immediate status so the client never sits in total silence while
    # the first LLM call decides on tool calls (it produces no tokens).
    yield {"type": "status", "stage": "thinking", "message": "正在思考…"}

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
