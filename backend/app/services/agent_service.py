from datetime import datetime
from typing import Any
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from app.core.config import get_settings
from app.models.user import User
from app.schemas import TaskCreate, TaskUpdate, TaskMove, TaskCommentCreate, TaskStatusCreate, TaskStatusUpdate
from app.services import task_service
from langchain_openai import ChatOpenAI

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
        tasks = await task_service.list_tasks(project_id, user, db, status_id=status_id, assignee_id=assignee_id)
        if not tasks:
            return "当前没有符合条件的任务。"
        lines = []
        for t in tasks:
            lines.append(
                f"- [{t.id}] {t.title} (状态id={t.status_id}, 优先级={t.priority}, 完成={t.is_completed}, "
                f"指派={t.assignee.display_name if t.assignee else '未指派'})"
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
            f"指派人：{t.assignee.display_name if t.assignee else '未指派'}\n"
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
    assignee_id: int | None = None,
    due_date: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """在当前项目创建任务。status_id 必须通过 get_project_info 获取。"""
    db, user, project_id = _get_deps(config)
    if status_id is None:
        return "创建任务必须提供 status_id，请先调用 get_project_info 获取状态列 ID。"
    try:
        data = TaskCreate(title=title, description=description, status_id=status_id, priority=priority)
        if assignee_id is not None:
            data.assignee_id = assignee_id
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
    assignee_id: int | None = None,
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
        if assignee_id is not None:
            payload["assignee_id"] = assignee_id
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
        c = await task_service.add_comment(project_id, task_id, TaskCommentCreate(content=content), user, db)
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
async def delete_status(status_id: int, config: RunnableConfig = None) -> str:
    """删除状态列（需要管理员权限）。"""
    db, user, project_id = _get_deps(config)
    try:
        await task_service.delete_status(project_id, status_id, user, db)
        return _format_result(
            True,
            message=f"已删除状态列 {status_id}。",
            action={"type": "delete_status", "status_id": status_id},
        )
    except Exception as e:
        return _format_result(False, message=str(e))


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
        "- 管理：create_status / update_status / delete_status（需要管理员权限）\n\n"
        "工作方式：先调用查询工具确认事实，再执行操作。对模糊请求，先询问用户或调用 get_project_info。"
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


async def run_agent(
    db,
    user: User,
    project_id: int,
    user_message: str,
    history_messages: list[dict] | None = None,
) -> dict:
    """Run the LangGraph ReAct agent and return assistant message + actions + all messages."""
    if not settings.llm_api_key:
        return {"message": "LLM 未配置，请在环境变量中设置 LLM_API_KEY。", "actions": [], "messages": []}

    project_summary = await task_service.get_project_summary(project_id, user, db)
    system_prompt = _build_system_prompt(project_summary)

    llm = ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=0.2,
        max_tokens=4096,
    )

    agent = create_react_agent(llm, tools, prompt=SystemMessage(content=system_prompt))

    actions: list[dict] = []
    config: RunnableConfig = {
        "configurable": {
            "db": db,
            "user": user,
            "project_id": project_id,
            "actions": actions,
        }
    }

    history = _convert_db_messages_to_lc(history_messages or [])
    input_messages = history + [HumanMessage(content=user_message)]

    try:
        result = await agent.ainvoke({"messages": input_messages}, config=config)
    except Exception as e:
        return {"message": f"抱歉，LLM 调用失败：{str(e)}", "actions": [], "messages": []}

    all_messages = result["messages"]
    final_message = all_messages[-1]
    return {
        "message": final_message.content or "",
        "actions": actions,
        "messages": all_messages,
    }
