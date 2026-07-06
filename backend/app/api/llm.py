from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.task import Task, TaskStatus
from app.schemas import LLMChatRequest, LLMChatResponse, LLMTaskGenerate
from app.services.llm_service import llm_service
from app.services.rag_service import rag_service

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.post("/chat", response_model=LLMChatResponse)
async def llm_chat(
    request: LLMChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Chat with LLM with project context from knowledge base."""
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
    db: AsyncSession = Depends(get_db),
):
    """Suggest which status a newly created task should go to."""
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
