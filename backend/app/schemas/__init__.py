from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.llm_chat import (
    LLMAgentChatRequest,
    LLMAgentChatResponse,
    LLMChatMessageOut,
    LLMChatSessionCreate,
    LLMChatSessionDetailOut,
    LLMChatSessionOut,
    LLMChatSessionUpdate,
)


# Auth
class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(default="", max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    email: EmailStr | None = None
    avatar_url: str | None = Field(default=None, max_length=512)


class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


class TokenData(BaseModel):
    user_id: int | None = None


# User
class UserOut(BaseModel):
    id: int
    username: str
    email: str
    display_name: str
    avatar_url: str
    is_active: bool
    is_superuser: bool = False
    is_approved: bool = False
    can_create_project: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class UserSearchOut(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_url: str

    model_config = {"from_attributes": True}


class UserBriefOut(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_url: str

    model_config = {"from_attributes": True}


# Project
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    description: str = Field(default="", max_length=10000)
    color: str = Field(default="#6366f1", pattern=r"^#[0-9A-Fa-f]{6}$")


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    description: str | None = Field(default=None, max_length=10000)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    is_archived: bool | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str
    color: str
    owner_id: int
    is_archived: bool
    created_at: datetime
    updated_at: datetime
    member_count: int = 0
    current_user_role: str = "viewer"

    model_config = {"from_attributes": True}


class ProjectMemberOut(BaseModel):
    id: int
    user_id: int
    role: str
    username: str = ""
    display_name: str = ""
    avatar_url: str = ""

    model_config = {"from_attributes": True}


class ProjectMemberAdd(BaseModel):
    user_id: int
    role: Literal["admin", "member", "viewer"] = "member"


class ProjectMemberUpdate(BaseModel):
    role: Literal["admin", "member", "viewer"]


# Task
class TaskStatusCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str = Field(default="#6b7280", pattern=r"^#[0-9A-Fa-f]{6}$")
    is_done: bool = False


class TaskStatusUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    order: int | None = Field(default=None, ge=0)
    is_done: bool | None = None


class TaskStatusOut(BaseModel):
    id: int
    project_id: int
    name: str
    order: int
    color: str
    is_done: bool
    task_count: int = 0

    model_config = {"from_attributes": True}


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    description: str = Field(default="", max_length=50000)
    status_id: int
    assignee_ids: list[int] = []
    priority: int = Field(default=0, ge=0, le=4)
    due_date: datetime | None = None
    parent_task_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    description: str | None = Field(default=None, max_length=50000)
    status_id: int | None = None
    assignee_ids: list[int] | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    order: float | None = None
    due_date: datetime | None = None
    is_completed: bool | None = None


class TaskOut(BaseModel):
    id: int
    project_id: int
    status_id: int
    parent_task_id: int | None = None
    title: str
    description: str
    priority: int
    order: float
    due_date: datetime | None = None
    is_completed: bool
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    assignees: list[UserBriefOut] = []
    comment_count: int = 0
    subtask_count: int = 0
    subtask_done: int = 0

    model_config = {"from_attributes": True}


class TaskDetailOut(TaskOut):
    subtasks: list["TaskOut"] = []
    comments: list["TaskCommentOut"] = []

    model_config = {"from_attributes": True}


class TaskCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


class TaskCommentUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


class TaskCommentOut(BaseModel):
    id: int
    task_id: int
    user_id: int
    content: str
    created_at: datetime
    updated_at: datetime
    user: UserBriefOut | None = None

    model_config = {"from_attributes": True}


class TaskAttachmentOut(BaseModel):
    id: int
    task_id: int
    uploader_id: int
    filename: str
    content_type: str
    size: int
    created_at: datetime

    model_config = {"from_attributes": True}


# Generic paginated envelope
class PageOut(BaseModel):
    total: int
    page: int
    page_size: int


class TaskListOut(PageOut):
    items: list[TaskOut]


class UserListOut(PageOut):
    items: list[UserOut]


class TaskMove(BaseModel):
    status_id: int
    order: float


# Cross-project task search
class TaskSearchItemOut(BaseModel):
    id: int
    project_id: int
    project_name: str = ""
    project_color: str = "#6366f1"
    status_id: int
    status_name: str = ""
    status_color: str = "#6b7280"
    title: str
    description: str
    priority: int
    is_completed: bool
    due_date: datetime | None = None
    updated_at: datetime
    assignees: list[UserBriefOut] = []

    model_config = {"from_attributes": True}


class TaskSearchListOut(BaseModel):
    tasks: list[TaskSearchItemOut]
    total: int


# Knowledge
class KnowledgeDocCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(max_length=2_000_000)
    file_type: str = Field(default="text", min_length=1, max_length=16)


class KnowledgeDocUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    content: str | None = Field(default=None, max_length=2_000_000)


class KnowledgeDocOut(BaseModel):
    id: int
    project_id: int
    title: str
    content: str
    file_type: str
    status: str = "indexed"
    error_message: str | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    chunk_count: int = 0

    model_config = {"from_attributes": True}


class KnowledgeDocListOut(PageOut):
    items: list[KnowledgeDocOut]


class KnowledgeChunkOut(BaseModel):
    id: int
    seq: int
    content: str
    has_embedding: bool = False

    model_config = {"from_attributes": True}


class KnowledgeChunkListOut(PageOut):
    items: list[KnowledgeChunkOut]


class KnowledgeQuery(BaseModel):
    question: str = Field(min_length=1, max_length=5000)
    top_k: int = Field(default=5, ge=1, le=20)


class KnowledgeAnswer(BaseModel):
    answer: str
    sources: list[dict] = Field(default_factory=list)


# LLM
class LLMChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=10000)


class LLMChatRequest(BaseModel):
    project_id: int
    messages: list[LLMChatMessage] = Field(min_length=1, max_length=100)


class LLMChatResponse(BaseModel):
    message: str
    actions: list[dict] = Field(default_factory=list)


# Stats
class ProjectStats(BaseModel):
    project_id: int
    project_name: str
    color: str
    total_tasks: int = 0
    completed_tasks: int = 0
    overdue_tasks: int = 0
    member_count: int = 0


class DashboardStats(BaseModel):
    projects: list[ProjectStats]


# Activity Log
class ActivityLogOut(BaseModel):
    id: int
    project_id: int
    user_id: int
    action: str
    target_type: str
    target_id: int
    summary: str
    created_at: datetime
    user_name: str = ""

    model_config = {"from_attributes": True}


class ActivityListOut(PageOut):
    items: list[ActivityLogOut]


class LLMTaskGenerate(BaseModel):
    project_id: int
    instruction: str = Field(min_length=1, max_length=10000)


# Notification
class NotificationOut(BaseModel):
    id: int
    user_id: int
    type: str
    title: str
    body: str = ""
    link: str = ""
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListOut(PageOut):
    items: list[NotificationOut]
    unread_count: int


__all__ = [
    "UserCreate",
    "UserLogin",
    "Token",
    "UserProfileUpdate",
    "PasswordChange",
    "TokenData",
    "UserOut",
    "UserSearchOut",
    "UserBriefOut",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectOut",
    "ProjectMemberOut",
    "ProjectMemberAdd",
    "ProjectMemberUpdate",
    "TaskStatusCreate",
    "TaskStatusUpdate",
    "TaskStatusOut",
    "TaskCreate",
    "TaskUpdate",
    "TaskOut",
    "TaskDetailOut",
    "TaskCommentCreate",
    "TaskCommentUpdate",
    "TaskCommentOut",
    "TaskAttachmentOut",
    "TaskMove",
    "PageOut",
    "TaskListOut",
    "ActivityListOut",
    "KnowledgeDocListOut",
    "UserListOut",
    "TaskSearchItemOut",
    "TaskSearchListOut",
    "KnowledgeDocCreate",
    "KnowledgeDocUpdate",
    "KnowledgeDocOut",
    "KnowledgeChunkOut",
    "KnowledgeChunkListOut",
    "KnowledgeQuery",
    "KnowledgeAnswer",
    "LLMChatMessage",
    "LLMChatRequest",
    "LLMChatResponse",
    "LLMTaskGenerate",
    "ProjectStats",
    "DashboardStats",
    "ActivityLogOut",
    "LLMChatSessionCreate",
    "LLMChatSessionUpdate",
    "LLMChatSessionOut",
    "LLMChatSessionDetailOut",
    "LLMChatMessageOut",
    "LLMAgentChatRequest",
    "LLMAgentChatResponse",
    "NotificationOut",
    "NotificationListOut",
]
