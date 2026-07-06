from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, EmailStr


# Auth
class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    display_name: str = ""


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserProfileUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None
    avatar_url: str | None = None


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


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


# Project
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    color: str = "#6366f1"


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
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

    model_config = {"from_attributes": True}


class ProjectMemberOut(BaseModel):
    id: int
    user_id: int
    role: str
    username: str = ""
    display_name: str = ""

    model_config = {"from_attributes": True}


class ProjectMemberAdd(BaseModel):
    user_id: int
    role: Literal["admin", "member", "viewer"] = "member"


# Task
class TaskStatusCreate(BaseModel):
    name: str
    color: str = "#6b7280"
    is_done: bool = False


class TaskStatusUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    order: int | None = None
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
    title: str
    description: str = ""
    status_id: int
    assignee_id: int | None = None
    priority: int = 0
    due_date: datetime | None = None
    parent_task_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status_id: int | None = None
    assignee_id: int | None = None
    priority: int | None = None
    order: float | None = None
    due_date: datetime | None = None
    is_completed: bool | None = None


class TaskOut(BaseModel):
    id: int
    project_id: int
    status_id: int
    assignee_id: int | None = None
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
    assignee: UserOut | None = None

    model_config = {"from_attributes": True}


class TaskDetailOut(TaskOut):
    subtasks: list["TaskOut"] = []
    comments: list["TaskCommentOut"] = []

    model_config = {"from_attributes": True}


class TaskCommentCreate(BaseModel):
    content: str


class TaskCommentOut(BaseModel):
    id: int
    task_id: int
    user_id: int
    content: str
    created_at: datetime
    user: UserOut | None = None

    model_config = {"from_attributes": True}


class TaskMove(BaseModel):
    status_id: int
    order: float


# Knowledge
class KnowledgeDocCreate(BaseModel):
    title: str
    content: str
    file_type: str = "text"


class KnowledgeDocUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


class KnowledgeDocOut(BaseModel):
    id: int
    project_id: int
    title: str
    content: str
    file_type: str
    created_by: int
    created_at: datetime
    updated_at: datetime
    chunk_count: int = 0

    model_config = {"from_attributes": True}


class KnowledgeQuery(BaseModel):
    question: str
    top_k: int = 5


class KnowledgeAnswer(BaseModel):
    answer: str
    sources: list[dict] = []


# LLM
class LLMChatMessage(BaseModel):
    role: str  # user, assistant, system
    content: str


class LLMChatRequest(BaseModel):
    project_id: int
    messages: list[LLMChatMessage]


class LLMChatResponse(BaseModel):
    message: str
    actions: list[dict] = []


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
class LLMTaskGenerate(BaseModel):
    project_id: int
    instruction: str  # e.g. "Create tasks for user login module"
