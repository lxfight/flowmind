import asyncio
import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.knowledge import DOC_STATUS_INDEXED, DocChunk, DocChunkEmbedding, KnowledgeDoc
from app.services.config_service import config_service

settings = get_settings()
logger = logging.getLogger(__name__)

_is_sqlite = "sqlite" in settings.database_url


def _is_retryable_embedding_error(exc: BaseException) -> bool:
    """429 / 5xx / network / timeout errors are worth retrying; 4xx client
    errors (bad key, bad model) are not."""
    from openai import APIConnectionError, APIStatusError, APITimeoutError

    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code == 429 or exc.status_code >= 500
    return False


async def call_with_embedding_retry(call, max_retries: int, base_delay: float):
    """Run an async callable with exponential-backoff retries (tenacity).

    Only retryable errors (429/5xx/network/timeout) are retried; the wait
    grows exponentially from ``base_delay`` with jitter. After attempts are
    exhausted the last exception propagates so the indexing pipeline can
    mark the document as failed.
    """
    from tenacity import (
        AsyncRetrying,
        retry_if_exception,
        stop_after_attempt,
        wait_exponential_jitter,
    )

    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(max_retries + 1),
        wait=wait_exponential_jitter(initial=base_delay, max=base_delay * 16),
        retry=retry_if_exception(_is_retryable_embedding_error),
        reraise=True,
    ):
        with attempt:
            return await call()
    return None  # unreachable; keeps type checkers happy


def _char_ngrams(text: str, n: int = 2) -> set[str]:
    """Character n-gram set of a (already lowercased) string."""
    if len(text) < n:
        return {text} if text else set()
    return {text[i:i + n] for i in range(len(text) - n + 1)}


def keyword_score(query: str, content: str, title: str) -> float:
    """Keyword relevance score in [0, 1], CJK-friendly (no tokenizer needed).

    Components:
    - bigram coverage of the query inside the content (main signal for
      Chinese text, where there are no spaces to tokenize on);
    - exact full-query substring hit in the content (strong signal);
    - bigram coverage / exact hit in the document title (weaker boosts).

    The score is 0 when nothing matches, so callers can treat score == 0
    as "no keyword evidence".
    """
    q = query.strip().lower()
    if not q:
        return 0.0
    c = content.lower()
    t = title.lower()

    grams = _char_ngrams(q)
    coverage = sum(1 for g in grams if g in c) / len(grams)
    title_coverage = sum(1 for g in grams if g in t) / len(grams)
    exact_content = 1.0 if q in c else 0.0
    exact_title = 1.0 if q in t else 0.0

    score = (
        0.55 * coverage
        + 0.25 * exact_content
        + 0.15 * title_coverage
        + 0.05 * exact_title
    )
    return min(1.0, score)


def rrf_fuse(
    vector_hits: list[dict],
    keyword_hits: list[dict],
    k: int = 60,
) -> list[dict]:
    """Reciprocal Rank Fusion of two ranked hit lists.

    Each hit is keyed by its chunk content (identical chunk text in both
    lists refers to the same chunk). The fused score for a chunk is
    ``sum(1 / (k + rank))`` over the lists it appears in, which avoids
    comparing raw vector similarities with keyword scores directly.

    Returns a list sorted by fused score (desc), each item carrying
    ``content`` / ``doc_title`` / ``vector_score`` (None when the chunk
    was not in the vector list) / ``keyword_score`` (0.0 when absent) /
    ``fused_score``.
    """
    merged: dict[str, dict] = {}

    for rank, hit in enumerate(vector_hits):
        entry = merged.setdefault(hit["content"], {
            "content": hit["content"],
            "doc_title": hit["doc_title"],
            "vector_score": None,
            "keyword_score": 0.0,
            "fused_score": 0.0,
        })
        entry["vector_score"] = hit["vector_score"]
        entry["fused_score"] += 1.0 / (k + rank + 1)

    for rank, hit in enumerate(keyword_hits):
        entry = merged.setdefault(hit["content"], {
            "content": hit["content"],
            "doc_title": hit["doc_title"],
            "vector_score": None,
            "keyword_score": 0.0,
            "fused_score": 0.0,
        })
        entry["keyword_score"] = hit["keyword_score"]
        entry["fused_score"] += 1.0 / (k + rank + 1)

    return sorted(merged.values(), key=lambda item: item["fused_score"], reverse=True)


class RAGService:
    """Retrieval-Augmented Generation service using pgvector."""

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embedding vectors for a batch of texts.

        Effective config is read per call so runtime changes take effect
        without a restart. Each request has a hard timeout (no more
        indefinitely hanging indexing tasks), and 429/5xx/network errors
        are retried with exponential backoff (tenacity). After retry
        exhaustion the exception propagates so the indexing pipeline can
        mark the document as failed.
        """
        from openai import AsyncOpenAI

        # Embedding credentials are independent from chat: they fall back
        # to llm_api_key / llm_base_url when not configured separately.
        api_key, base_url, embedding_model = await config_service.get_embedding_credentials()
        timeout = await config_service.get("embedding_timeout")
        max_retries = await config_service.get("embedding_max_retries")
        base_delay = await config_service.get("embedding_retry_base_delay")

        # SDK built-in retries disabled (max_retries=0): the retry policy
        # lives in call_with_embedding_retry so 429 backoff is explicit
        # and configurable.
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or None,
            timeout=timeout,
            max_retries=0,
        )

        async def call() -> list[list[float]]:
            response = await client.embeddings.create(model=embedding_model, input=texts)
            return [item.embedding for item in response.data]

        return await call_with_embedding_retry(call, max_retries, base_delay)

    async def embed_text(self, text: str) -> list[float]:
        """Generate an embedding vector for a single text."""
        return (await self.embed_texts([text]))[0]

    async def split_and_store_chunks(
        self, title: str, content: str, doc_id: int, db: AsyncSession
    ) -> list[DocChunk]:
        """Split document content and store plain chunks (no embeddings)."""
        chunk_size = await config_service.get("chunk_size")
        chunk_overlap = await config_service.get("chunk_overlap")
        chunks = self._split_text(content, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
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
        return stored_chunks

    async def embed_chunks(self, stored_chunks: list[DocChunk], db: AsyncSession) -> None:
        """Embed stored chunks in batches with bounded concurrency.

        Faster than strictly serial calls while keeping request pressure
        low enough to avoid 429s. Batch-level failures (after retry
        exhaustion) propagate so the indexing pipeline can mark the
        document as failed.
        """
        batch_size = max(1, await config_service.get("embedding_batch_size"))
        concurrency = max(1, await config_service.get("embedding_concurrency"))
        semaphore = asyncio.Semaphore(concurrency)
        batches = [
            stored_chunks[i:i + batch_size]
            for i in range(0, len(stored_chunks), batch_size)
        ]

        async def embed_batch(batch: list[DocChunk]) -> list[list[float]]:
            async with semaphore:
                return await self.embed_texts([c.content for c in batch])

        all_embeddings = await asyncio.gather(*(embed_batch(b) for b in batches))

        for batch, embeddings in zip(batches, all_embeddings, strict=True):
            for doc_chunk, embedding in zip(batch, embeddings, strict=True):
                # pgvector's Vector type binds list[float] on both
                # PostgreSQL (native vector) and SQLite (serialized).
                db.add(DocChunkEmbedding(
                    chunk_id=doc_chunk.id,
                    embedding=embedding,
                ))

    async def chunk_document(self, title: str, content: str, doc_id: int, db: AsyncSession):
        """Split document into chunks and store with embeddings."""
        stored_chunks = await self.split_and_store_chunks(title, content, doc_id, db)

        # Keep plain chunks useful in local/unconfigured environments.
        embedding_api_key, _, _ = await config_service.get_embedding_credentials()
        if not embedding_api_key:
            return

        await self.embed_chunks(stored_chunks, db)

    async def _retrieve_keyword(
        self,
        query: str,
        project_id: int,
        db: AsyncSession,
        candidate_limit: int,
    ) -> list[dict]:
        """Keyword retrieval over all indexed chunks of a project.

        Scores every chunk with ``keyword_score`` and returns the top
        candidates with score > 0, best first. No match means an empty
        list ("no relevant knowledge") — it deliberately does NOT fall
        back to the first N chunks.
        """
        result = await db.execute(
            select(DocChunk.content, KnowledgeDoc.title)
            .join(KnowledgeDoc)
            .where(KnowledgeDoc.project_id == project_id)
            .where(KnowledgeDoc.status == DOC_STATUS_INDEXED)
        )
        rows = result.all()

        scored = [
            {
                "content": content,
                "doc_title": title,
                "keyword_score": keyword_score(query, content, title),
            }
            for content, title in rows
        ]
        hits = [h for h in scored if h["keyword_score"] > 0]
        hits.sort(key=lambda h: h["keyword_score"], reverse=True)
        return hits[:candidate_limit]

    async def _retrieve_vector(
        self,
        query: str,
        project_id: int,
        db: AsyncSession,
        candidate_limit: int,
    ) -> list[dict]:
        """Vector retrieval via pgvector cosine distance (PostgreSQL only).

        Returns the top candidates by cosine similarity (1 - distance),
        best first, WITHOUT applying the similarity threshold — threshold
        filtering happens after fusion so keyword-strong chunks survive.
        Raises on embedding/DB errors; the caller degrades gracefully.
        """
        query_embedding = await self.embed_text(query)
        query_embedding_str = str(query_embedding)
        result = await db.execute(
            text("""
                SELECT
                    dc.content,
                    kd.title as doc_title,
                    1 - (dce.embedding <=> CAST(:query_embedding AS vector)) as similarity
                FROM doc_chunk_embeddings dce
                JOIN doc_chunks dc ON dc.id = dce.chunk_id
                JOIN knowledge_docs kd ON kd.id = dc.doc_id
                WHERE kd.project_id = :project_id
                  AND kd.status = :doc_status
                ORDER BY dce.embedding <=> CAST(:query_embedding AS vector)
                LIMIT :candidate_limit
            """),
            {
                "query_embedding": query_embedding_str,
                "project_id": project_id,
                "candidate_limit": candidate_limit,
                "doc_status": DOC_STATUS_INDEXED,
            },
        )
        return [
            {
                "content": row[0],
                "doc_title": row[1],
                "vector_score": float(row[2]),
            }
            for row in result.fetchall()
        ]

    @staticmethod
    def _final_hit(item: dict) -> dict:
        """Normalize a fused item into the public hit shape.

        ``similarity`` is kept for backward compatibility: it is the
        vector score when available, otherwise the keyword score.
        """
        vector_score = item.get("vector_score")
        keyword_score = item.get("keyword_score", 0.0)
        return {
            "content": item["content"],
            "doc_title": item["doc_title"],
            "similarity": vector_score if vector_score is not None else keyword_score,
            "vector_score": vector_score,
            "keyword_score": keyword_score,
            "fused_score": item.get("fused_score", 0.0),
        }

    async def retrieve_context(
        self,
        query: str,
        project_id: int,
        db: AsyncSession,
        top_k: int | None = None,
    ) -> list[dict]:
        """Hybrid retrieval: vector search + keyword search, RRF-fused.

        - Keyword retrieval always runs (substring/n-gram scorer).
        - Vector retrieval runs when possible (PostgreSQL + embedding
          credentials); failures degrade to pure keyword ranking.
        - The similarity threshold filters chunks whose ONLY evidence is
          a weak vector score; chunks with any keyword hit survive.
        """
        result_limit = top_k if top_k is not None else await config_service.get("top_k_retrieval")
        threshold = await config_service.get("similarity_threshold")
        candidate_limit = max(result_limit * 4, 20)

        keyword_hits = await self._retrieve_keyword(query, project_id, db, candidate_limit)

        vector_hits: list[dict] = []
        embedding_api_key, _, _ = await config_service.get_embedding_credentials()
        if not _is_sqlite and embedding_api_key:
            try:
                vector_hits = await self._retrieve_vector(query, project_id, db, candidate_limit)
            except Exception as exc:
                logger.warning("Vector retrieval failed; using keyword-only ranking: %s", exc)

        if not vector_hits:
            # Degraded path: pure keyword ranking.
            return [self._final_hit(h) for h in keyword_hits[:result_limit]]

        fused = rrf_fuse(vector_hits, keyword_hits)
        results = []
        for item in fused:
            vector_score = item["vector_score"]
            # Filter chunks whose only evidence is a below-threshold
            # vector score; keyword hits keep the chunk relevant.
            if vector_score is not None and vector_score < threshold and item["keyword_score"] == 0:
                continue
            results.append(self._final_hit(item))
            if len(results) >= result_limit:
                break
        return results

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
                {
                    "title": c["doc_title"],
                    "relevance": c["similarity"],
                    "vector_score": c.get("vector_score"),
                    "keyword_score": c.get("keyword_score"),
                }
                for c in contexts
            ],
        }

    def _split_text(
        self,
        text: str,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ) -> list[str]:
        """Split text into chunks by paragraphs, with inter-chunk overlap.

        - Paragraphs (blank-line separated) are greedily packed up to
          ``chunk_size`` characters before a cut is made.
        - Adjacent chunks share up to ``chunk_overlap`` characters, taken
          from the tail of the previous chunk.
        - A single paragraph longer than ``chunk_size`` is hard-split by
          characters (also with overlap) so no oversized chunk survives.
        - ``chunk_overlap`` is defensively clamped to half of ``chunk_size``.

        The signature stays backward compatible: sizes fall back to
        ``settings.chunk_size`` / ``settings.chunk_overlap`` when omitted.
        """
        import re

        size = chunk_size if chunk_size is not None else settings.chunk_size
        size = max(1, size)
        overlap = chunk_overlap if chunk_overlap is not None else settings.chunk_overlap
        overlap = max(0, min(overlap, size // 2))

        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
        if not paragraphs:
            return [text] if text else []

        # Normalize to segments no longer than `size`: hard-split long
        # paragraphs by characters, carrying `overlap` characters between
        # consecutive slices.
        segments: list[str] = []
        for p in paragraphs:
            if len(p) <= size:
                segments.append(p)
                continue
            step = max(1, size - overlap)
            for start in range(0, len(p), step):
                segments.append(p[start:start + size])
                if start + size >= len(p):
                    break

        # Greedily pack segments; each new chunk inherits the previous
        # chunk's tail (up to `overlap` chars) as context overlap.
        chunks: list[str] = []
        current = ""
        for seg in segments:
            candidate = seg if not current else f"{current}\n\n{seg}"
            if len(candidate) <= size:
                current = candidate
                continue
            chunks.append(current)
            tail = current[-overlap:] if overlap else ""
            current = f"{tail}\n\n{seg}" if tail else seg
            # The overlap tail must never push a chunk past `size`.
            if len(current) > size:
                current = seg

        if current:
            chunks.append(current)

        return chunks if chunks else [text]


# Global singleton
rag_service = RAGService()
