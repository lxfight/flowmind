from fastapi import APIRouter, Depends
from app.schemas import LLMChatRequest, LLMChatResponse, LLMTaskGenerate
from app.core.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.post("/chat", response_model=LLMChatResponse)
async def llm_chat(request: LLMChatRequest, current_user: User = Depends(get_current_user)):
    pass


@router.post("/generate-tasks", response_model=list)
async def llm_generate_tasks(
    request: LLMTaskGenerate,
    current_user: User = Depends(get_current_user),
):
    pass


@router.post("/suggest-status")
async def llm_suggest_status():
    pass
