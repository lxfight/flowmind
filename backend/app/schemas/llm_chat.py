from datetime import datetime
from pydantic import BaseModel, ConfigDict


class LLMChatSessionCreate(BaseModel):
    project_id: int
    title: str = "新会话"


class LLMChatSessionUpdate(BaseModel):
    title: str


class LLMChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    title: str
    created_at: datetime
    updated_at: datetime


class LLMChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    role: str
    content: str
    tool_calls: list[dict] | None = None
    tool_results: list[dict] | None = None
    actions: list[dict] | None = None
    ordinal: int
    created_at: datetime


class LLMChatSessionDetailOut(LLMChatSessionOut):
    messages: list[LLMChatMessageOut] = []


class LLMAgentChatRequest(BaseModel):
    project_id: int
    session_id: int | None = None
    message: str


class LLMAgentChatResponse(BaseModel):
    session_id: int
    message: str
    actions: list[dict] = []
