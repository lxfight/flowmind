from typing import Optional
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings

settings = get_settings()


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

        for i, chunk_text in enumerate(chunks):
            embedding = await self.embed_text(chunk_text)

            # Store chunk
            result = await db.execute(
                text("""
                    INSERT INTO doc_chunks (doc_id, content, chunk_index)
                    VALUES (:doc_id, :content, :chunk_index)
                    RETURNING id
                """),
                {
                    "doc_id": doc_id,
                    "content": chunk_text,
                    "chunk_index": i,
                },
            )
            chunk_id = result.scalar()

            # Store embedding vector
            await db.execute(
                text("""
                    INSERT INTO doc_chunk_embeddings (chunk_id, embedding)
                    VALUES (:chunk_id, :embedding::vector)
                """),
                {
                    "chunk_id": chunk_id,
                    "embedding": embedding,
                },
            )

    async def retrieve_context(
        self, query: str, project_id: int, db: AsyncSession
    ) -> list[dict]:
        """Retrieve relevant document chunks for a query."""
        query_embedding = await self.embed_text(query)

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
                ORDER BY dce.embedding <=> :query_embedding::vector
                LIMIT :top_k
            """),
            {
                "query_embedding": query_embedding,
                "project_id": project_id,
                "top_k": settings.top_k_retrieval,
            },
        )

        rows = result.fetchall()
        return [
            {
                "content": row[0],
                "doc_title": row[2],
                "similarity": float(row[3]),
            }
            for row in rows
        ]

    async def query_with_context(
        self, query: str, project_id: int, db: AsyncSession, llm_service
    ) -> dict:
        """Answer a question using retrieved context."""
        contexts = await self.retrieve_context(query, project_id, db)

        if not contexts:
            return {
                "answer": "知识库中未找到相关文档。",
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
