import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.errors import GraphRecursionError
from langgraph.prebuilt import ToolNode, create_react_agent
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.config import get_settings
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


def _local_tz():
    try:
        return ZoneInfo(get_settings().app_timezone)
    except Exception:
        return UTC


def _parse_due_date(value: str) -> datetime:
    """Parse an LLM-supplied due date into an aware datetime in the local zone.

    The model usually returns a bare ``YYYY-MM-DD``; interpreting that as UTC
    midnight would surface as the previous/next day in the user's local zone and
    skew due-reminder comparisons. Anchor bare dates to end-of-day local time so
    "明天截止" stays "明天" everywhere. Explicit datetimes keep their time (and
    are assumed local when naive).
    """
    text = value.strip()
    dt = datetime.fromisoformat(text)
    tz = _local_tz()
    if dt.tzinfo is not None:
        return dt
    if len(text) == 10:  # bare date YYYY-MM-DD → end of that day, local time
        return dt.replace(hour=23, minute=59, second=59, tzinfo=tz)
    return dt.replace(tzinfo=tz)


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


def _normalize_key(text: str) -> str:
    """Collapse whitespace/case so '整理迭代计划' and ' 整理迭代计划 ' dedupe."""
    return " ".join((text or "").split()).lower()


def _created_keys(config: RunnableConfig) -> dict:
    """Per-run store of idempotency results for mutating tool calls.

    ``_build_agent_run`` seeds ``config['configurable']['created_keys']`` with
    a fresh dict every run, so the guard is scoped to that run and never blocks
    a deliberate re-create in a later message or session. The tool must mutate
    the seeded dict in place: the tool wrapper snapshots ``configurable``, so a
    lazy ``cfg['created_keys'] = ...`` rebind would be lost between calls.

    Maps an idempotency key (tuple) to the JSON result string of the first
    successful call, so a repeated call replays that result verbatim instead of
    mutating again.
    """
    cfg = config.get("configurable", {})
    keys = cfg.get("created_keys")
    if keys is None:  # direct unit invocation without _build_agent_run
        keys = {}
        cfg["created_keys"] = keys
    return keys


def _last_mutations(config: RunnableConfig) -> dict:
    """Last successful state mutation per resource, for adjacent retry replay."""
    cfg = config.get("configurable", {})
    mutations = cfg.get("last_mutations")
    if mutations is None:
        mutations = {}
        cfg["last_mutations"] = mutations
    return mutations


def _mutation_lock(config: RunnableConfig) -> asyncio.Lock:
    """Serialize writes sharing the run's AsyncSession and idempotency stores."""
    cfg = config.get("configurable", {})
    lock = cfg.get("mutation_lock")
    if lock is None:
        lock = asyncio.Lock()
        cfg["mutation_lock"] = lock
    return lock


@asynccontextmanager
async def _locked_mutation(config: RunnableConfig):
    async with _mutation_lock(config):
        yield


def _format_result(ok: bool, message: str = "", action: dict | None = None) -> str:
    payload = {"ok": ok, "message": message or ("操作成功。" if ok else "操作失败。")}
    if action:
        payload["action"] = action
    return json.dumps(payload, ensure_ascii=False)


def _idem_lookup(config: RunnableConfig, key: tuple) -> str | None:
    """Return the cached result for ``key`` if this call already ran this run.

    Used by every mutating tool so a repeated identical call within one run is
    a no-op that replays the first successful result (the model occasionally
    emits the same write twice, or parallel duplicate tool calls).
    """
    return _created_keys(config).get(key)


def _idem_store(config: RunnableConfig, key: tuple, result: str) -> str:
    """Cache a successful result under ``key`` and return it unchanged.

    Also surfaces the embedded ``action`` to the run's shared ``actions`` list so
    the client renders an operation card per mutation. This is the single choke
    point every mutating tool's success path flows through, so populating the
    list here covers all of them (``result.actions`` was previously always empty
    because nothing populated it). A repeated call hits ``_idem_lookup`` and
    returns before reaching here, so the card is recorded exactly once.
    """
    _created_keys(config)[key] = result
    try:
        action = json.loads(result).get("action")
    except (ValueError, AttributeError):
        action = None
    if action:
        _record_action(config, action)
    return result


def _repeat_lookup(config: RunnableConfig, resource: tuple, signature: tuple) -> str | None:
    """Replay only the latest mutation on a resource, not any call in the run.

    This suppresses adjacent/concurrent retries while allowing legitimate
    A -> B -> A transitions later in the same agent run.
    """
    previous = _last_mutations(config).get(resource)
    if previous and previous[0] == signature:
        return previous[1]
    return None


def _repeat_store(config: RunnableConfig, resource: tuple, signature: tuple, result: str) -> str:
    _last_mutations(config)[resource] = (signature, result)
    try:
        action = json.loads(result).get("action")
    except (ValueError, AttributeError):
        action = None
    if action:
        _record_action(config, action)
    return result


def _payload_key(**values: Any) -> str:
    """Stable JSON signature for tool arguments used in idempotency keys."""
    return json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


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


MAX_BATCH_ITEMS = 50


class BatchTaskItem(BaseModel):
    """One independently configurable task inside create_tasks."""

    title: str = Field(min_length=1, max_length=512)
    status_id: int
    description: str = ""
    priority: int = Field(default=0, ge=0, le=4)
    assignee_ids: list[int] | None = None
    due_date: str | None = None
    subtasks: list[str] | None = None


def _task_idem_key(target: int, item: BatchTaskItem) -> tuple:
    payload = item.model_dump()
    payload["title"] = _normalize_key(item.title)
    payload["assignee_ids"] = sorted(item.assignee_ids or [])
    payload["subtasks"] = [_normalize_key(title) for title in item.subtasks or []]
    return (
        "create_task",
        target,
        _payload_key(**payload),
    )


async def _create_one_task(
    db, user, target: int, title: str, description: str, status_id: int,
    priority: int, assignee_ids: list[int] | None, due_date: str | None,
    subtasks: list[str] | None,
) -> tuple[Any, list[Any]]:
    """Create one task (and its subtasks) via the service layer.

    Returns (task, subtasks). Each insert goes through task_service so every
    row gets its own ActivityLog entry under the run's shared action_batch_id —
    the whole batch stays undoable as a unit.
    """
    data = TaskCreate(title=title, description=description, status_id=status_id, priority=priority)
    if assignee_ids:
        data.assignee_ids = assignee_ids
    if due_date:
        data.due_date = _parse_due_date(due_date)
    t = await task_service.create_task(target, data, user, db)
    subs = []
    for sub_title in subtasks or []:
        sub_title = (sub_title or "").strip()
        if sub_title:
            subs.append(await task_service.add_subtask(target, t.id, sub_title, user, db))
    return t, subs


@tool
async def create_task(
    title: str,
    description: str = "",
    status_id: int | None = None,
    priority: int = 0,
    assignee_ids: list[int] | None = None,
    due_date: str | None = None,
    subtasks: list[str] | None = None,
    project_id: int | None = None,
    config: RunnableConfig = None,
) -> str:
    """创建单个任务（可用 subtasks 顺带建子任务）。status_id 必须先从 get_project_info 获取。

    一次要创建多个任务时改用 create_tasks。
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

    # Idempotency: the model occasionally fires two identical create_task calls
    # in one turn (same title), which used to insert duplicate tasks. Within a
    # single run, a repeated (project, title) replays the first call's result.
    item = BatchTaskItem(
        title=title,
        description=description,
        status_id=status_id,
        priority=priority,
        assignee_ids=assignee_ids,
        due_date=due_date,
        subtasks=subtasks,
    )
    idem_key = _task_idem_key(target, item)
    async with _locked_mutation(config):
        cached = _idem_lookup(config, idem_key)
        if cached is not None:
            return cached
        try:
            t, subs = await _create_one_task(
                db, user, target, title, description, status_id, priority,
                assignee_ids, due_date, subtasks,
            )
            label = f"{_proj_label(names, target)}" if ctx_pid is None else ""
            sub_note = f"（含 {len(subs)} 个子任务）" if subs else ""
            result = _format_result(
                True,
                message=f"已在{label}创建任务 [{t.id}] {t.title}{sub_note}。",
                action={"type": "create_task", "task_id": t.id, "title": t.title},
            )
            return _idem_store(config, idem_key, result)
        except Exception as e:
            return _format_result(False, message=str(e))


@tool
async def create_tasks(
    tasks: list[BatchTaskItem] | None = None,
    titles: list[str] | None = None,
    status_id: int | None = None,
    description: str = "",
    priority: int = 0,
    assignee_ids: list[int] | None = None,
    due_date: str | None = None,
    project_id: int | None = None,
    config: RunnableConfig = None,
) -> str:
    """批量创建任务；tasks 可为每项配置独立属性。创建两个及以上任务时必须优先使用。

    推荐传 tasks；兼容的 titles 模式会让所有任务共享 status_id 等公共属性。
    status_id 必须先从 get_project_info 获取，单次最多 50 项。
    跨项目会话中：用户已指明项目时传 project_id；不传则会向用户追问目标项目。
    """
    db, user, ctx_pid, project_ids, names = _get_ctx(config)
    if tasks and titles:
        return _format_result(False, message="tasks 和 titles 只能使用一种批量输入方式。")
    items = list(tasks or [])
    if titles:
        if status_id is None:
            return _format_result(False, message="使用 titles 批量创建时必须提供 status_id。")
        items = [
            BatchTaskItem(
                title=title.strip(),
                status_id=status_id,
                description=description,
                priority=priority,
                assignee_ids=assignee_ids,
                due_date=due_date,
            )
            for title in titles
            if (title or "").strip()
        ]
    if not items:
        return "没有提供任何任务标题。"
    if len(items) > MAX_BATCH_ITEMS:
        return _format_result(False, message=f"单次最多批量创建 {MAX_BATCH_ITEMS} 个任务，请拆分后重试。")
    target, err = _resolve_target_project(config, project_id)
    if target is None:
        if err == "ASK":
            return "目标项目不明确，已向用户提问要在哪个项目中创建，请立即结束本轮回复。"
        return _format_result(False, message=err)

    label = f"{_proj_label(names, target)}" if ctx_pid is None else ""
    created, failed, skipped = [], [], []
    async with _locked_mutation(config):
        for item in items:
            idem_key = _task_idem_key(target, item)
            if _idem_lookup(config, idem_key) is not None:
                skipped.append(item.title)
                continue
            try:
                # A failed item rolls back to its savepoint without poisoning
                # the rest of the batch transaction.
                async with db.begin_nested():
                    t, subs = await _create_one_task(
                        db, user, target, item.title, item.description, item.status_id,
                        item.priority, item.assignee_ids, item.due_date, item.subtasks,
                    )
                created.append((t, subs))
                _idem_store(
                    config,
                    idem_key,
                    _format_result(
                        True,
                        message=f"已在{label}创建任务 [{t.id}] {t.title}。",
                        action={"type": "create_task", "task_id": t.id, "title": t.title},
                    ),
                )
            except Exception as e:
                failed.append(f"{item.title}（{e}）")

    parts = []
    if created:
        parts.append(
            f"已在{label}批量创建 {len(created)} 个任务："
            + "、".join(f"[{t.id}] {t.title}" for t, _subs in created)
        )
    if skipped:
        parts.append(f"跳过 {len(skipped)} 个本轮已创建的任务：" + "、".join(skipped))
    if failed:
        parts.append(f"失败 {len(failed)} 个：" + "；".join(failed))
    if not parts:
        parts = ["没有创建任何任务。"]
    # No aggregate action here: each created task already recorded its own
    # create_task action card in the loop above.
    return _format_result(not failed, message="\n".join(parts))


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
            payload["due_date"] = _parse_due_date(due_date) if due_date else None
        if is_completed is not None:
            payload["is_completed"] = is_completed
        if not payload:
            return "没有提供任何要更新的字段。"
        signature = ("update_task", _payload_key(**payload))
        resource = ("task", task_id)
        async with _locked_mutation(config):
            cached = _repeat_lookup(config, resource, signature)
            if cached is not None:
                return cached
            data = TaskUpdate(**payload)
            t = await task_service.update_task(pid, task_id, data, user, db)
            result = _format_result(
                True,
                message=f"已更新任务 [{t.id}] {t.title}。",
                action={"type": "update_task", "task_id": t.id, "title": t.title},
            )
            return _repeat_store(config, resource, signature, result)
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
        signature = ("move_task", status_id)
        resource = ("task", task_id)
        async with _locked_mutation(config):
            cached = _repeat_lookup(config, resource, signature)
            if cached is not None:
                return cached
            data = TaskMove(status_id=status_id, order=0)
            t = await task_service.move_task(pid, task_id, data, user, db)
            result = _format_result(
                True,
                message=f"已将任务 [{t.id}] {t.title} 移动到状态 {status_id}。",
                action={
                    "type": "move_task",
                    "task_id": t.id,
                    "status_id": t.status_id,
                    "title": t.title,
                },
            )
            return _repeat_store(config, resource, signature, result)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def add_comment(task_id: int, content: str, config: RunnableConfig = None) -> str:
    """给任务添加评论。"""
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={task_id}（不属于你参与的项目）。")
    idem_key = ("add_comment", task_id, _normalize_key(content))
    try:
        async with _locked_mutation(config):
            cached = _idem_lookup(config, idem_key)
            if cached is not None:
                return cached
            await task_service.add_comment(
                pid, task_id, TaskCommentCreate(content=content), user, db
            )
            result = _format_result(
                True,
                message=f"已为任务 [{task_id}] 添加评论。",
                action={"type": "add_comment", "task_id": task_id},
            )
            return _idem_store(config, idem_key, result)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def add_subtask(parent_task_id: int, title: str, config: RunnableConfig = None) -> str:
    """为任务添加单个子任务。一次要添加多个子任务时请改用 add_subtasks。"""
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, parent_task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={parent_task_id}（不属于你参与的项目）。")
    # Idempotency: a repeated identical add_subtask within one run replays the
    # first result instead of inserting a duplicate subtask (the reported bug).
    idem_key = ("add_subtask", parent_task_id, _normalize_key(title))
    try:
        async with _locked_mutation(config):
            cached = _idem_lookup(config, idem_key)
            if cached is not None:
                return cached
            t = await task_service.add_subtask(pid, parent_task_id, title, user, db)
            result = _format_result(
                True,
                message=f"已添加子任务 [{t.id}] {t.title}。",
                action={
                    "type": "add_subtask",
                    "task_id": t.id,
                    "parent_task_id": parent_task_id,
                    "title": t.title,
                },
            )
            return _idem_store(config, idem_key, result)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def add_subtasks(parent_task_id: int, titles: list[str], config: RunnableConfig = None) -> str:
    """批量为一个任务添加多个子任务（传入标题列表）。添加多个子任务时优先用本工具。"""
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, parent_task_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到任务 id={parent_task_id}（不属于你参与的项目）。")
    clean_titles = [t.strip() for t in titles if (t or "").strip()]
    if not clean_titles:
        return "没有提供任何子任务标题。"
    if len(clean_titles) > MAX_BATCH_ITEMS:
        return _format_result(False, message=f"单次最多批量添加 {MAX_BATCH_ITEMS} 个子任务，请拆分后重试。")

    created, failed, skipped = [], [], []
    async with _locked_mutation(config):
        for title in clean_titles:
            idem_key = ("add_subtask", parent_task_id, _normalize_key(title))
            if _idem_lookup(config, idem_key) is not None:
                skipped.append(title)
                continue
            try:
                async with db.begin_nested():
                    t = await task_service.add_subtask(pid, parent_task_id, title, user, db)
                created.append(t)
                _idem_store(
                    config,
                    idem_key,
                    _format_result(
                        True,
                        message=f"已添加子任务 [{t.id}] {t.title}。",
                        action={
                            "type": "add_subtask",
                            "task_id": t.id,
                            "parent_task_id": parent_task_id,
                            "title": t.title,
                        },
                    ),
                )
            except Exception as e:
                failed.append(f"{title}（{e}）")

    parts = []
    if created:
        parts.append(
            f"已为任务 [{parent_task_id}] 批量添加 {len(created)} 个子任务："
            + "、".join(f"[{t.id}] {t.title}" for t in created)
        )
    if skipped:
        parts.append(f"跳过 {len(skipped)} 个本轮已添加的子任务：" + "、".join(skipped))
    if failed:
        parts.append(f"失败 {len(failed)} 个：" + "；".join(failed))
    if not parts:
        parts = ["没有添加任何子任务。"]
    # No aggregate action: each created subtask already recorded its own
    # add_subtask action card in the loop above.
    return _format_result(not failed, message="\n".join(parts))


@tool
async def update_subtask(subtask_id: int, is_completed: bool, config: RunnableConfig = None) -> str:
    """更新子任务完成状态。"""
    db, user, ctx_pid, project_ids, _names = _get_ctx(config)
    pid = ctx_pid if ctx_pid is not None else await _find_task_project(db, subtask_id, project_ids)
    if pid is None:
        return _format_result(False, message=f"未找到子任务 id={subtask_id}（不属于你参与的项目）。")
    try:
        signature = ("update_subtask", is_completed)
        resource = ("task", subtask_id)
        async with _locked_mutation(config):
            cached = _repeat_lookup(config, resource, signature)
            if cached is not None:
                return cached
            t = await task_service.update_subtask(pid, subtask_id, is_completed, user, db)
            result = _format_result(
                True,
                message=f"已更新子任务 [{t.id}] 完成状态为 {is_completed}。",
                action={"type": "update_subtask", "task_id": t.id, "is_completed": is_completed},
            )
            return _repeat_store(config, resource, signature, result)
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

    # Same idempotency guard as create_task: avoid duplicate status columns
    # when the model repeats an identical create_status call within one run.
    idem_key = (
        "create_status",
        target,
        _payload_key(name=_normalize_key(name), color=color, is_done=is_done),
    )
    try:
        async with _locked_mutation(config):
            cached = _idem_lookup(config, idem_key)
            if cached is not None:
                return cached
            s = await task_service.create_status(
                target, TaskStatusCreate(name=name, color=color, is_done=is_done), user, db
            )
            label = f"{_proj_label(names, target)}" if ctx_pid is None else ""
            result = _format_result(
                True,
                message=f"已在{label}创建状态列 [{s.id}] {s.name}。",
                action={"type": "create_status", "status_id": s.id, "name": s.name},
            )
            return _idem_store(config, idem_key, result)
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
        signature = ("update_status", _payload_key(**payload))
        resource = ("status", status_id)
        async with _locked_mutation(config):
            cached = _repeat_lookup(config, resource, signature)
            if cached is not None:
                return cached
            data = TaskStatusUpdate(**payload)
            s = await task_service.update_status(pid, status_id, data, user, db)
            result = _format_result(
                True,
                message=f"已更新状态列 [{s.id}] {s.name}。",
                action={"type": "update_status", "status_id": s.id, "name": s.name},
            )
            return _repeat_store(config, resource, signature, result)
    except Exception as e:
        return _format_result(False, message=str(e))


@tool
async def delete_status(status_id: int, confirmed: bool = False, config: RunnableConfig = None) -> str:
    """删除状态列（需管理员权限，破坏性操作）。

    默认 confirmed=False 时不真正删除，只返回待确认信息；必须先向用户说明影响并获得
    明确同意后，再以 confirmed=True 调用。"""
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
        idem_key = ("delete_status", status_id)
        async with _locked_mutation(config):
            cached = _idem_lookup(config, idem_key)
            if cached is not None:
                return cached
            await task_service.delete_status(pid, status_id, user, db)
            result = _format_result(
                True,
                message=f"已删除状态列 {status_id}。",
                action={"type": "delete_status", "status_id": status_id},
            )
            return _idem_store(config, idem_key, result)
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
MAX_TOOL_CALLS_PER_RUN = 20
AGENT_RECURSION_LIMIT = 48


def _batch_required_message(request) -> str | None:
    """Reject parallel single-item creates that should be one batch call."""
    state = request.state if isinstance(request.state, dict) else {}
    messages = state.get("messages") or []
    latest = messages[-1] if messages else None
    calls = getattr(latest, "tool_calls", None) or []
    current = request.tool_call
    name = current.get("name")

    if name == "create_task" and sum(call.get("name") == name for call in calls) >= 2:
        return (
            "检测到本轮同时创建多个任务。为减少工具调用，未执行这些单条请求；"
            "请立即合并为一次 create_tasks 调用，并把每个任务放入 tasks 数组。"
        )
    if name == "add_subtask":
        parent_id = (current.get("args") or {}).get("parent_task_id")
        same_parent = sum(
            call.get("name") == name
            and (call.get("args") or {}).get("parent_task_id") == parent_id
            for call in calls
        )
        if same_parent >= 2:
            return (
                "检测到本轮为同一父任务添加多个子任务。未执行这些单条请求；"
                "请立即合并为一次 add_subtasks 调用。"
            )
    return None


async def _bounded_tool_call(request, execute):
    """Enforce a hard execution budget and runtime batch-first routing."""
    batch_message = _batch_required_message(request)
    if batch_message:
        return ToolMessage(
            content=_format_result(False, message=batch_message),
            name=request.tool_call.get("name", ""),
            tool_call_id=request.tool_call.get("id", ""),
            status="error",
        )

    config = request.runtime.config
    cfg = config.get("configurable", {})
    budget = cfg.get("tool_budget")
    lock = cfg.get("tool_budget_lock")
    if budget is not None and lock is not None:
        async with lock:
            budget["used"] += 1
            over_budget = budget["used"] > budget["limit"]
        if over_budget:
            return ToolMessage(
                content=_format_result(
                    False,
                    message=(
                        f"本轮已达到 {budget['limit']} 次工具调用上限。"
                        "不要再调用工具，请基于已有结果直接回复用户。"
                    ),
                ),
                name=request.tool_call.get("name", ""),
                tool_call_id=request.tool_call.get("id", ""),
                status="error",
            )

    return await execute(request)


# Tools grouped by category. Registering a new tool = write the @tool function
# (its docstring first line becomes the summary) and add it to the matching
# group below — the JSON schema AND the system-prompt listing both update
# automatically, so there is nothing else to keep in sync.
TOOL_GROUPS: list[tuple[str, list]] = [
    ("查询", [get_project_info, list_tasks, search_tasks, get_task, get_members]),
    ("操作", [create_task, create_tasks, update_task, move_task, add_comment,
              add_subtask, add_subtasks, update_subtask]),
    ("管理", [create_status, update_status, delete_status]),
    ("知识库", [search_knowledge, list_knowledge_docs, read_knowledge_doc, get_doc_content]),
    ("提问", [ask_user]),
]

# Flat list handed to LangChain; order follows TOOL_GROUPS.
tools = [t for _group, members in TOOL_GROUPS for t in members]


def _tool_summary(tool_obj) -> str:
    """First line of a tool's docstring, used as its one-line summary."""
    doc = (getattr(tool_obj, "description", None) or "").strip()
    return doc.splitlines()[0].strip() if doc else ""


def _build_tools_listing() -> str:
    """Auto-generated Chinese tool catalog for the system prompt.

    Derived from TOOL_GROUPS + each tool's docstring so it can never drift out
    of sync with the actual registered tools.
    """
    lines = ["可用工具（按用途分组）："]
    for group, members in TOOL_GROUPS:
        names = " / ".join(t.name for t in members)
        lines.append(f"- {group}：{names}")
        for t in members:
            summary = _tool_summary(t)
            if summary:
                lines.append(f"  · {t.name}：{summary}")
    return "\n".join(lines) + "\n\n"


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
    "工作方式：先调用查询工具确认事实，再执行操作。\n"
    "批量优先规则：\n"
    "- 创建两个及以上任务时必须只调用一次 create_tasks，使用 tasks 数组为每项提供独立属性；"
    "不得并行或连续多次调用 create_task。\n"
    "- 为同一父任务添加两个及以上子任务时必须只调用一次 add_subtasks；"
    "不得并行或连续多次调用 add_subtask。\n"
    "- 单次批量最多 50 项；超出时拆成尽可能少的批次。\n"
    "创建/更新类操作每个条目只做一次：同一标题或相同调用不要在同一轮重复发起，"
    "系统已对所有写操作做幂等去重，重复调用会被自动忽略，无需重试。\n"
    "用中文回答，保持专业友好。"
)


_WEEKDAYS_CN = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


def _current_time_context() -> str:
    """Local current date/time block injected into the system prompt.

    The server clock is UTC, but users reason and see times in their local
    zone (``app_timezone``). Without this the model has no sense of "now" and
    misinterprets relative dates like 今天 / 明天 / 本周 / 下个月.
    """
    try:
        tz = ZoneInfo(get_settings().app_timezone)
    except Exception:
        tz = UTC
    now = datetime.now(tz)
    # Local zone abbreviation (CST / UTC+8 / etc.), falling back to the offset.
    tz_label = now.tzname() or now.strftime("UTC%z")
    return (
        "当前时间信息：\n"
        f"- 现在：{now.strftime('%Y-%m-%d %H:%M')}（{_WEEKDAYS_CN[now.weekday()]}，时区 {tz_label}）\n"
        f"- 今天日期：{now.strftime('%Y-%m-%d')}\n"
        "- 用户提到「今天/明天/昨天/本周/下周/下个月」等相对时间时，请以上述当前时间为准换算成"
        "具体日期（YYYY-MM-DD），再用于创建/查询任务。\n\n"
    )


def _build_system_prompt(project_summary: dict) -> str:
    return (
        "你是 FlowMind 智能助手，帮助用户管理任务和项目。你只能通过提供的工具操作当前项目，"
        "禁止编造 ID。所有 task_id、status_id、assignee_id 必须从工具查询结果中获取。\n\n"
        + _current_time_context()
        + f"当前项目：{project_summary['project_name']}\n"
        f"描述：{project_summary['project_description'] or '无'}\n\n"
        + _build_tools_listing()
        + _SHARED_RULES
    )


def _build_cross_project_prompt(project_names: dict[int, str]) -> str:
    listing = "\n".join(f"- [id={pid}] {name}" for pid, name in project_names.items())
    return (
        "你是 FlowMind 智能助手，当前处于跨项目模式：用户同时参与多个项目，"
        "你可以跨这些项目查询和操作。禁止编造 ID，所有 id 必须来自工具查询结果。\n\n"
        + _current_time_context()
        + f"用户参与的项目：\n{listing}\n\n"
        "跨项目规则：\n"
        "- 查询类工具（list_tasks / search_tasks / search_knowledge / list_knowledge_docs）"
        "默认覆盖以上所有项目，结果会标注来源项目；回答时注明信息来自哪个项目。\n"
        "- get_project_info / get_members 需要用 project_id 参数指定项目。\n"
        "- get_task / read_knowledge_doc / get_doc_content 以及按 task_id 定位的更新/移动/"
        "评论/子任务操作会自动解析所属项目（仅限以上项目）。\n"
        "- 创建类写操作（create_task / create_status）必须明确目标项目：用户已指明项目时"
        "用 project_id 参数传入；用户未指明时直接调用工具（会触发向用户提问），"
        "绝不自行假设默认项目。\n\n"
        + _build_tools_listing()
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


def _extract_reasoning(chunk) -> str:
    """Pull any reasoning/thinking text out of a streamed chat chunk.

    Different OpenAI-compatible providers expose chain-of-thought differently:
    some set ``additional_kwargs.reasoning_content``, others emit content
    blocks typed ``thinking``/``reasoning``. Returns "" when absent so callers
    can skip the thinking event for plain providers.
    """
    additional = getattr(chunk, "additional_kwargs", None) or {}
    reasoning = additional.get("reasoning_content") or additional.get("thinking")
    if isinstance(reasoning, str) and reasoning:
        return reasoning
    content = getattr(chunk, "content", "")
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") in ("thinking", "reasoning"):
                text = block.get("thinking") or block.get("text") or block.get("reasoning")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


_TOOL_OUTPUT_MAX = 500


def _tool_output_text(output) -> str:
    """Compact tool-return text for the client to expand inline (truncated)."""
    content = getattr(output, "content", output)
    text = _content_to_text(content).strip()
    if len(text) > _TOOL_OUTPUT_MAX:
        text = text[:_TOOL_OUTPUT_MAX] + "…"
    return text


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

    tool_node = ToolNode(tools, awrap_tool_call=_bounded_tool_call)
    agent = create_react_agent(llm, tool_node, prompt=SystemMessage(content=system_prompt))

    actions: list[dict] = []
    pending_question: dict = {}
    config: RunnableConfig = {
        "recursion_limit": AGENT_RECURSION_LIMIT,
        "configurable": {
            "db": db,
            "user": user,
            "project_id": project_id,
            "project_ids": project_ids,
            "project_names": project_names,
            "actions": actions,
            "pending_question": pending_question,
            # Seeded per run so mutating tools dedupe repeated identical calls.
            "created_keys": {},
            "last_mutations": {},
            "mutation_lock": asyncio.Lock(),
            "tool_budget": {"used": 0, "limit": MAX_TOOL_CALLS_PER_RUN},
            "tool_budget_lock": asyncio.Lock(),
        }
    }

    history = _convert_db_messages_to_lc(history_messages or [])
    input_messages = history + [HumanMessage(content=user_message)]
    # One batch id per run; mutations stamp it on their ActivityLog rows so
    # the whole run can be undone as a unit.
    action_batch_id = uuid.uuid4().hex
    return agent, input_messages, config, actions, pending_question, action_batch_id


def _finalize_result(all_messages: list, actions: list[dict], pending_question: dict | None = None,
                     action_batch_id: str | None = None, steps: list[dict] | None = None) -> dict:
    final_message = all_messages[-1]
    return {
        "message": _content_to_text(final_message.content),
        "actions": actions,
        "messages": all_messages,
        "pending_question": pending_question or None,
        "action_batch_id": action_batch_id,
        "steps": steps or None,
    }


def _error_result(message: str) -> dict:
    return {
        "message": message,
        "actions": [],
        "messages": [],
        "pending_question": None,
        "action_batch_id": None,
        "steps": None,
    }


def _run_failure_result(
    message: str,
    input_messages: list,
    actions: list[dict],
    pending_question: dict,
    action_batch_id: str,
    steps: list[dict] | None = None,
) -> dict:
    """Return a visible, undoable result when a run fails after mutations."""
    messages = [*input_messages, AIMessage(content=message)]
    return _finalize_result(messages, actions, pending_question, action_batch_id, steps)


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
    except GraphRecursionError:
        return _run_failure_result(
            "本轮处理已达到执行步数上限。我已停止继续调用工具；已完成的操作仍可在此消息中撤销。",
            input_messages,
            actions,
            pending_question,
            action_batch_id,
        )
    except Exception as e:
        return _run_failure_result(
            f"抱歉，LLM 调用失败：{str(e)}。已完成的操作仍可在此消息中撤销。",
            input_messages,
            actions,
            pending_question,
            action_batch_id,
        )
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
    process_steps: list[dict] = []
    batch_token = task_service.set_agent_batch(action_batch_id)
    try:
        async for event in agent.astream_events(
            {"messages": input_messages}, config=config, version="v2"
        ):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk is not None:
                    # Surface the model's reasoning/thinking stream separately
                    # when the provider exposes it (reasoning_content on the
                    # chunk, or content blocks of type "thinking"/"reasoning").
                    reasoning = _extract_reasoning(chunk)
                    if reasoning:
                        if process_steps and process_steps[-1].get("kind") == "thinking":
                            process_steps[-1]["text"] = process_steps[-1].get("text", "") + reasoning
                        else:
                            process_steps.append({"kind": "thinking", "text": reasoning})
                        yield {"type": "thinking", "text": reasoning}
                    text = _content_to_text(getattr(chunk, "content", ""))
                    if text:
                        yield {"type": "token", "text": text}
            elif kind == "on_tool_start":
                name = event.get("name", "")
                args = event.get("data", {}).get("input")
                step = {
                    "kind": "tool",
                    "id": event.get("run_id", ""),
                    "tool": name,
                    "args": args if isinstance(args, dict) else {},
                    "status": "running",
                }
                process_steps.append(step)
                yield {
                    "type": "tool_start",
                    # run_id pairs this start with its tool_end on the client.
                    "id": event.get("run_id", ""),
                    "name": name,
                    "args": args if isinstance(args, dict) else {},
                }
            elif kind == "on_tool_end":
                run_id = event.get("run_id", "")
                output_text = _tool_output_text(event.get("data", {}).get("output"))
                for step in reversed(process_steps):
                    if step.get("kind") == "tool" and step.get("id") == run_id:
                        step["status"] = "done"
                        step["output"] = output_text
                        break
                yield {
                    "type": "tool_end",
                    "id": run_id,
                    "name": event.get("name", ""),
                    "output": output_text,
                }
            elif kind == "on_chain_end":
                # Every internal node fires on_chain_end and they overwrite each
                # other; only the top-level LangGraph output carries the full
                # message list (intermediate nodes drop the tool messages).
                if event.get("name") != "LangGraph":
                    continue
                output = event.get("data", {}).get("output")
                if isinstance(output, dict) and "messages" in output:
                    final_messages = output["messages"]
    except GraphRecursionError:
        yield {
            "type": "result",
            "result": _run_failure_result(
                "本轮处理已达到执行步数上限。我已停止继续调用工具；已完成的操作仍可在此消息中撤销。",
                input_messages,
                actions,
                pending_question,
                action_batch_id,
                process_steps,
            ),
        }
        return
    except Exception as e:
        yield {
            "type": "result",
            "result": _run_failure_result(
                f"抱歉，LLM 调用失败：{str(e)}。已完成的操作仍可在此消息中撤销。",
                input_messages,
                actions,
                pending_question,
                action_batch_id,
                process_steps,
            ),
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

    yield {
        "type": "result",
        "result": _finalize_result(
            final_messages,
            actions,
            pending_question,
            action_batch_id,
            process_steps,
        ),
    }
