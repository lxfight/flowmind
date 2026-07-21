from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Session scope: "project" = tied to one project; "all_my_projects" = a
# cross-project session whose LLMChatSession.project_id is NULL.
SessionScope = Literal["project", "all_my_projects"]


class LLMChatSessionCreate(BaseModel):
    # None (or omitted) creates a cross-project session.
    project_id: int | None = None
    title: str = Field(default="新会话", min_length=1, max_length=128)


class LLMChatSessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=128)


class LLMChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # NULL identifies a cross-project session.
    project_id: int | None
    title: str
    awaiting_input: bool = False
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
    pending_question: dict | None = None
    action_batch_id: str | None = None
    undone_at: datetime | None = None
    ordinal: int
    created_at: datetime


class LLMChatSessionDetailOut(LLMChatSessionOut):
    messages: list[LLMChatMessageOut] = Field(default_factory=list)


class LLMAgentChatRequest(BaseModel):
    # scope="project" requires project_id; scope="all_my_projects" starts /
    # continues a cross-project session (project_id must be omitted).
    scope: SessionScope = "project"
    project_id: int | None = None
    session_id: int | None = None
    message: str = Field(min_length=1, max_length=10000)


class LLMAgentChatResponse(BaseModel):
    session_id: int
    message: str
    actions: list[dict] = Field(default_factory=list)
    pending_question: dict | None = None
    action_batch_id: str | None = None
