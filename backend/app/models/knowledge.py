from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

try:
    from pgvector.sqlalchemy import Vector
except ImportError:
    Vector = None  # fallback for SQLite

    class Vector:  # type: ignore
        pass


class KnowledgeDoc(Base):
    __tablename__ = "knowledge_docs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    file_type: Mapped[str] = mapped_column(String(16), default="text")  # text, markdown, pdf
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    project = relationship("Project", back_populates="knowledge_docs")
    chunks = relationship("DocChunk", back_populates="doc", cascade="all, delete-orphan")
    embeddings = relationship("DocChunkEmbedding", back_populates="doc", cascade="all, delete-orphan")


class DocChunk(Base):
    __tablename__ = "doc_chunks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    doc_id: Mapped[int] = mapped_column(ForeignKey("knowledge_docs.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    doc = relationship("KnowledgeDoc", back_populates="chunks")
    embedding = relationship("DocChunkEmbedding", back_populates="chunk", uselist=False, cascade="all, delete-orphan")


class DocChunkEmbedding(Base):
    """pgvector embedding for document chunks."""
    __tablename__ = "doc_chunk_embeddings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    chunk_id: Mapped[int] = mapped_column(ForeignKey("doc_chunks.id", ondelete="CASCADE"), nullable=False, unique=True)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536) if Vector else Text, nullable=False)

    # Relationships
    chunk = relationship("DocChunk", back_populates="embedding")
    doc = relationship("KnowledgeDoc", back_populates="embeddings", overlaps="chunks,embedding")
