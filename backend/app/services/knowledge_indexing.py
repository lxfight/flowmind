"""Background knowledge-document indexing pipeline.

Chunking + embedding run outside the request so uploads/creates/edits
return immediately with status='indexing'. Each task opens its own
session (the request-scoped get_db session is closed by then).

Concurrency: a per-document asyncio.Lock serializes re-indexing. The
latest edit always wins — the task re-reads the document content after
acquiring the lock, so a stale task scheduled before an edit simply
indexes the newest content.
"""
import asyncio
import logging

from sqlalchemy import delete

from app.core import database
from app.models.knowledge import (
    KnowledgeDoc,
    DocChunk,
    DOC_STATUS_INDEXING,
    DOC_STATUS_INDEXED,
    DOC_STATUS_FAILED,
)
from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)

# Per-document locks serialize concurrent re-index runs for the same doc.
_doc_locks: dict[int, asyncio.Lock] = {}


def _lock_for(doc_id: int) -> asyncio.Lock:
    lock = _doc_locks.get(doc_id)
    if lock is None:
        lock = asyncio.Lock()
        _doc_locks[doc_id] = lock
    return lock


async def _mark_failed(doc_id: int, message: str) -> None:
    async with database.async_session_factory() as session:
        doc = await session.get(KnowledgeDoc, doc_id)
        if doc is not None:
            doc.status = DOC_STATUS_FAILED
            doc.error_message = message[:2000]
            await session.commit()


async def _run_index(doc_id: int) -> None:
    """Chunk + embed the doc's current content; set final status."""
    async with _lock_for(doc_id):
        async with database.async_session_factory() as session:
            try:
                doc = await session.get(KnowledgeDoc, doc_id)
                if doc is None:
                    return  # deleted while indexing was pending
                # Latest edit wins: read content now, under the lock.
                await session.execute(delete(DocChunk).where(DocChunk.doc_id == doc.id))
                await rag_service.chunk_document(doc.title, doc.content, doc.id, session)
                doc.status = DOC_STATUS_INDEXED
                doc.error_message = None
                await session.commit()
            except Exception as exc:
                await session.rollback()
                logger.warning("Indexing failed for doc %s: %s", doc_id, exc)
                await _mark_failed(doc_id, f"文档索引失败: {exc}")
        _doc_locks.pop(doc_id, None)


async def index_document(doc_id: int) -> None:
    """Background entry point: (re-)index an existing doc's stored content."""
    await _run_index(doc_id)


async def index_uploaded_document(doc_id: int, file_bytes: bytes, ext: str) -> None:
    """Background entry point for uploads: parse → chunk → embed.

    markitdown can be slow, so parsing happens here, behind the same
    status flow ('indexing' → 'indexed' / 'failed' with error_message).
    """
    try:
        from io import BytesIO
        from markitdown import MarkItDown

        md = MarkItDown()
        result = md.convert_stream(BytesIO(file_bytes), file_extension=ext)
        content = result.text_content
        if not content.strip():
            raise ValueError("文件解析结果为空，请检查文件内容")
    except Exception as exc:
        logger.warning("File parsing failed for doc %s: %s", doc_id, exc)
        await _mark_failed(doc_id, f"文件解析失败: {exc}")
        return

    async with database.async_session_factory() as session:
        doc = await session.get(KnowledgeDoc, doc_id)
        if doc is None:
            return
        doc.content = content
        doc.status = DOC_STATUS_INDEXING
        await session.commit()

    await _run_index(doc_id)
