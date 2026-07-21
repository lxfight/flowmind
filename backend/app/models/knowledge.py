from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import get_settings
from app.core.database import Base

# Single source of truth for the pgvector column size.
# Changing llm_embedding_dim on an existing deployment requires a manual
# migration to resize the embedding column.
EMBEDDING_DIM = get_settings().llm_embedding_dim

# KnowledgeDoc indexing status values.
DOC_STATUS_PARSING = "parsing"
DOC_STATUS_INDEXING = "indexing"
DOC_STATUS_INDEXED = "indexed"
DOC_STATUS_FAILED = "failed"


class KnowledgeDoc(Base):
    __tablename__ = "knowledge_docs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    file_type: Mapped[str] = mapped_column(String(16), default="text")  # text, markdown, pdf
    # Indexing pipeline status: parsing | indexing | indexed | failed
    status: Mapped[str] = mapped_column(String(16), default=DOC_STATUS_INDEXING, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project = relationship("Project", back_populates="knowledge_docs")
    chunks = relationship("DocChunk", back_populates="doc", cascade="all, delete-orphan")


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
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)

    # Relationships
    chunk = relationship("DocChunk", back_populates="embedding")
