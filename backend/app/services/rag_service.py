import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.knowledge import DOC_STATUS_INDEXED, DocChunk, DocChunkEmbedding, KnowledgeDoc

settings = get_settings()
logger = logging.getLogger(__name__)

_is_sqlite = "sqlite" in settings.database_url


class RAGService:
    """Retrieval-Augmented Generation service using pgvector."""

    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding vector for text."""
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url or None,
        )

        response = await client.embeddings.create(
            model=settings.llm_embedding_model,
            input=text,
        )
        return response.data[0].embedding

    async def chunk_document(self, title: str, content: str, doc_id: int, db: AsyncSession):
        """Split document into chunks and store with embeddings."""
        chunks = self._split_text(content)
        stored_chunks = []
        for i, chunk_text in enumerate(chunks):
            doc_chunk = DocChunk(
                doc_id=doc_id,
                content=chunk_text,
                chunk_index=i,
            )
            db.add(doc_chunk)
            await db.flush()
            stored_chunks.append(doc_chunk)

        # Keep plain chunks useful in local/unconfigured environments.
        if not settings.llm_api_key:
            return

        for doc_chunk in stored_chunks:
            # Embedding failures propagate so the indexing pipeline can mark
            # the document as failed with an error message.
            embedding = await self.embed_text(doc_chunk.content)
            if _is_sqlite:
                # SQLite: store embedding as JSON string for dev/testing
                import json
                doc_embedding = DocChunkEmbedding(
                    chunk_id=doc_chunk.id,
                    embedding=json.dumps(embedding),
                )
            else:
                doc_embedding = DocChunkEmbedding(
                    chunk_id=doc_chunk.id,
                    embedding=embedding,
                )
            db.add(doc_embedding)

    async def _retrieve_plain_text(
        self,
        query: str,
        project_id: int,
        db: AsyncSession,
        result_limit: int,
    ) -> list[dict]:
        """Keyword fallback retrieval (SQLite dev / no LLM key).

        Only actual substring matches are returned, ranked by match count
        with a boost for title hits. Deliberately does NOT fall back to the
        first N chunks: no match means an empty list ("no relevant knowledge").
        Similarity is reported as 0.0 since there is no vector score.
        """
        result = await db.execute(
            select(DocChunk.content, KnowledgeDoc.title)
            .join(KnowledgeDoc)
            .where(KnowledgeDoc.project_id == project_id)
            .where(KnowledgeDoc.status == DOC_STATUS_INDEXED)
        )
        rows = result.all()

        needle = query.lower()
        scored = []
        for content, title in rows:
            content_hits = content.lower().count(needle)
            title_hits = title.lower().count(needle)
            if content_hits == 0 and title_hits == 0:
                continue
            # Title matches are a stronger signal; boost them.
            score = content_hits + title_hits * 3
            scored.append((score, content, title))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            {
                "content": content,
                "doc_title": title,
                "similarity": 0.0,
            }
            for _, content, title in scored[:result_limit]
        ]

    async def retrieve_context(
        self,
        query: str,
        project_id: int,
        db: AsyncSession,
        top_k: int | None = None,
    ) -> list[dict]:
        """Retrieve relevant document chunks for a query."""
        result_limit = top_k if top_k is not None else settings.top_k_retrieval
        if _is_sqlite or not settings.llm_api_key:
            return await self._retrieve_plain_text(query, project_id, db, result_limit)

        # PostgreSQL: cosine distance via pgvector
        try:
            query_embedding = await self.embed_text(query)
        except Exception as exc:
            logger.warning("Query embedding failed; using plain-text retrieval: %s", exc)
            return await self._retrieve_plain_text(query, project_id, db, result_limit)
        query_embedding_str = str(query_embedding)
        result = await db.execute(
            text("""
                SELECT
                    dc.content,
                    dc.chunk_index,
                    kd.title as doc_title,
                    1 - (dce.embedding <=> :query_embedding::vector) as similarity
                FROM doc_chunk_embeddings dce
                JOIN doc_chunks dc ON dc.id = dce.chunk_id
                JOIN knowledge_docs kd ON kd.id = dc.doc_id
                WHERE kd.project_id = :project_id
                  AND kd.status = :doc_status
                ORDER BY dce.embedding <=> :query_embedding::vector
                LIMIT :top_k
            """),
            {
                "query_embedding": query_embedding_str,
                "project_id": project_id,
                "top_k": result_limit,
                "doc_status": DOC_STATUS_INDEXED,
            },
        )

        rows = result.fetchall()
        # The SQL computes similarity = 1 - cosine_distance (range roughly
        # [-1, 1], higher is better). Filter out chunks below the configured
        # similarity threshold; if everything is filtered, return an empty
        # list so callers treat it as "no relevant knowledge".
        threshold = settings.similarity_threshold
        return [
            {
                "content": row[0],
                "doc_title": row[2],
                "similarity": float(row[3]),
            }
            for row in rows
            if float(row[3]) >= threshold
        ]

    async def query_with_context(
        self,
        query: str,
        project_id: int,
        db: AsyncSession,
        llm_service,
        top_k: int | None = None,
    ) -> dict:
        """Answer a question using retrieved context."""
        contexts = await self.retrieve_context(query, project_id, db, top_k=top_k)

        if not contexts:
            # Explicitly tell the LLM there is no relevant knowledge so it
            # says so instead of hallucinating sources.
            answer = await llm_service.chat(
                messages=[{
                    "role": "user",
                    "content": (
                        f"用户问题：{query}\n\n"
                        "（系统提示：知识库检索没有找到任何相关内容。）"
                    ),
                }],
                system_prompt=(
                    "你是一个知识库助手。知识库中没有检索到与用户问题相关的内容。"
                    "请明确告知用户知识库中未找到相关内容，不要编造来源或文档。"
                ),
            )
            return {
                "answer": answer,
                "sources": [],
            }

        context_text = "\n\n".join(
            [f"[来源: {c['doc_title']}]\n{c['content']}" for c in contexts]
        )

        system_prompt = (
            "你是一个知识库助手。根据提供的文档内容回答问题。"
            "如果文档内容不足以回答问题，请如实告知。"
            "引用来源时请标注文档名称。"
        )

        prompt = f"""基于以下项目文档回答用户问题：

文档内容：
{context_text}

用户问题：{query}"""

        answer = await llm_service.chat(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system_prompt,
        )

        return {
            "answer": answer,
            "sources": [
                {"title": c["doc_title"], "relevance": c["similarity"]}
                for c in contexts
            ],
        }

    def _split_text(self, text: str) -> list[str]:
        """Split text into chunks by paragraphs and size."""
        import re

        paragraphs = re.split(r'\n\s*\n', text)
        chunks = []
        current = ""

        for p in paragraphs:
            p = p.strip()
            if not p:
                continue
            if len(current) + len(p) < settings.chunk_size:
                current += ("\n\n" if current else "") + p
            else:
                if current:
                    chunks.append(current)
                current = p

        if current:
            chunks.append(current)

        return chunks if chunks else [text]


# Global singleton
rag_service = RAGService()
