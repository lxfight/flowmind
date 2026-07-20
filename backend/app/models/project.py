from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(7), default="#6366f1")  # hex color
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_archived: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    statuses = relationship("TaskStatus", back_populates="project", cascade="all, delete-orphan",
                            order_by="TaskStatus.order")
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    knowledge_docs = relationship("KnowledgeDoc", back_populates="project", cascade="all, delete-orphan")
    owner = relationship("User")
    chat_sessions = relationship("LLMChatSession", back_populates="project")


class ProjectMember(Base):
    __tablename__ = "project_members"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(
        String(16), default="member"
    )  # owner, admin, member, viewer
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    project = relationship("Project", back_populates="members")
    user = relationship("User", back_populates="project_memberships")
