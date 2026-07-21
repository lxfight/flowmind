"""Unit tests for RAGService._split_text (paragraph packing + overlap).

These tests call _split_text directly with explicit sizes, so they do not
depend on settings or the database.
"""
from app.services.rag_service import RAGService

svc = RAGService()


def _paragraphs(n: int, width: int) -> str:
    return "\n\n".join(f"段落{i}-" + "x" * width for i in range(n))


def test_empty_and_blank_text():
    assert svc._split_text("", chunk_size=100, chunk_overlap=10) == []
    # Fallback keeps the raw text when no non-empty paragraph exists
    assert svc._split_text("   ", chunk_size=100, chunk_overlap=10) == ["   "]


def test_short_text_single_chunk():
    text = "第一段。\n\n第二段。"
    assert svc._split_text(text, chunk_size=100, chunk_overlap=10) == [text]


def test_paragraph_packing_respects_chunk_size():
    # 6 paragraphs of ~30 chars; size 100 packs ~3 per chunk
    text = _paragraphs(6, 25)
    chunks = svc._split_text(text, chunk_size=100, chunk_overlap=0)
    assert len(chunks) >= 2
    for c in chunks:
        assert len(c) <= 100


def test_adjacent_chunks_overlap_from_previous_tail():
    text = _paragraphs(6, 25)
    size, overlap = 100, 20
    chunks = svc._split_text(text, chunk_size=size, chunk_overlap=overlap)
    assert len(chunks) >= 2
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        # The next chunk starts with a suffix of the previous chunk
        tail = prev[-overlap:]
        assert nxt.startswith(tail[:overlap // 2])  # shared prefix region
        shared = nxt[:overlap]
        assert shared in prev or shared.split("\n\n")[0] in prev


def test_long_paragraph_hard_split():
    text = "y" * 250
    chunks = svc._split_text(text, chunk_size=100, chunk_overlap=10)
    assert len(chunks) == 3  # step = 90 -> slices at 0, 90, 180
    for c in chunks:
        assert len(c) <= 100


def test_hard_split_carries_overlap():
    text = "".join(chr(ord("a") + i % 26) for i in range(250))
    chunks = svc._split_text(text, chunk_size=100, chunk_overlap=10)
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        assert nxt[:10] == prev[-10:]


def test_overlap_clamped_to_half_chunk_size():
    # overlap > size/2 is clamped to size//2
    text = "z" * 250
    chunks = svc._split_text(text, chunk_size=100, chunk_overlap=80)
    assert len(chunks) >= 2
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        assert nxt[:50] == prev[-50:]


def test_overlap_zero_behaves_like_plain_cut():
    text = _paragraphs(4, 60)
    chunks = svc._split_text(text, chunk_size=100, chunk_overlap=0)
    assert len(chunks) >= 2
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        assert not nxt.startswith(prev[-20:])


def test_no_content_loss_with_overlap():
    # Every paragraph's text still appears across the chunk sequence
    text = _paragraphs(8, 30)
    chunks = svc._split_text(text, chunk_size=80, chunk_overlap=16)
    joined = "\n\n".join(chunks)
    for i in range(8):
        assert f"段落{i}-" in joined


def test_mixed_long_and_short_paragraphs():
    text = "短段。\n\n" + "w" * 300 + "\n\n又一个短段。"
    chunks = svc._split_text(text, chunk_size=100, chunk_overlap=10)
    for c in chunks:
        assert len(c) <= 100
    assert any("短段。" in c for c in chunks)
    assert any("又一个短段。" in c for c in chunks)
