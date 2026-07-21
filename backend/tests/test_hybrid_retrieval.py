"""Unit tests for the hybrid-retrieval pure functions.

Covers the CJK-friendly keyword scorer and the RRF fusion used by
RAGService.retrieve_context. All functions under test are pure.
"""
from app.services.rag_service import _char_ngrams, keyword_score, rrf_fuse


def _vhit(content: str, score: float, title: str = "文档A") -> dict:
    return {"content": content, "doc_title": title, "vector_score": score}


def _khit(content: str, score: float, title: str = "文档A") -> dict:
    return {"content": content, "doc_title": title, "keyword_score": score}


# ---------------------------------------------------------------------------
# keyword_score
# ---------------------------------------------------------------------------
def test_keyword_score_no_match_is_zero():
    assert keyword_score("完全无关的词", "今天天气不错，适合出门散步。", "日记") == 0.0


def test_keyword_score_empty_query_is_zero():
    assert keyword_score("", "任意内容", "标题") == 0.0
    assert keyword_score("   ", "任意内容", "标题") == 0.0


def test_keyword_score_exact_substring_beats_partial():
    full = keyword_score("项目进度报告", "本周的项目进度报告已经提交。", "周报")
    partial = keyword_score("项目进度报告", "项目延期了，进度需要重新评估。", "周报")
    assert full > partial > 0


def test_keyword_score_title_hit_boosts_score():
    title_hit = keyword_score("季度总结", "内容里没有完全对应的表述。", "季度总结文档")
    no_title = keyword_score("季度总结", "内容里没有完全对应的表述。", "随便什么标题")
    assert title_hit > no_title


def test_keyword_score_chinese_bigram_coverage():
    # Content shares bigrams with the query but not the full string
    score = keyword_score("机器学习模型训练", "我们讨论了机器学习和模型部署。", "笔记")
    assert 0 < score < 1


def test_keyword_score_bounded_to_one():
    score = keyword_score("测试", "测试 测试 测试", "测试")
    assert score <= 1.0
    assert score > 0.9  # all components firing should approach 1


def test_keyword_score_english_words():
    score = keyword_score("machine learning", "we love machine learning here", "notes")
    assert score > 0.5


def test_keyword_score_case_insensitive():
    assert keyword_score("RAG", "关于 rag 检索的说明", "文档") > 0


def test_char_ngrams_short_text():
    assert _char_ngrams("短") == {"短"}
    assert _char_ngrams("") == set()
    assert _char_ngrams("abcd") == {"ab", "bc", "cd"}


# ---------------------------------------------------------------------------
# rrf_fuse
# ---------------------------------------------------------------------------
def test_rrf_fuse_ranking_and_scores():
    vector_hits = [_vhit("chunk-1", 0.9), _vhit("chunk-2", 0.8)]
    keyword_hits = [_khit("chunk-2", 0.7), _khit("chunk-3", 0.5)]

    fused = rrf_fuse(vector_hits, keyword_hits, k=60)

    # chunk-2 appears in both lists and must outrank single-list chunks
    assert fused[0]["content"] == "chunk-2"
    by_content = {h["content"]: h for h in fused}
    assert by_content["chunk-2"]["vector_score"] == 0.8
    assert by_content["chunk-2"]["keyword_score"] == 0.7
    assert by_content["chunk-1"]["keyword_score"] == 0.0
    assert by_content["chunk-3"]["vector_score"] is None


def test_rrf_fuse_score_formula():
    fused = rrf_fuse([_vhit("a", 0.9)], [], k=60)
    assert fused[0]["fused_score"] == 1.0 / 61
    # rank 2 in the same list
    fused = rrf_fuse([_vhit("a", 0.9), _vhit("b", 0.1)], [], k=60)
    assert fused[1]["fused_score"] == 1.0 / 62


def test_rrf_fuse_dual_membership_sums():
    # rank 1 in vector (1/61) + rank 1 in keyword (1/61)
    fused = rrf_fuse([_vhit("a", 0.9)], [_khit("a", 0.5)], k=60)
    assert abs(fused[0]["fused_score"] - 2.0 / 61) < 1e-12


def test_rrf_fuse_empty_inputs():
    assert rrf_fuse([], []) == []
    fused = rrf_fuse([], [_khit("x", 0.3)])
    assert len(fused) == 1
    assert fused[0]["vector_score"] is None


def test_rrf_fuse_custom_k_changes_scores():
    fused_k10 = rrf_fuse([_vhit("a", 0.9)], [], k=10)
    fused_k60 = rrf_fuse([_vhit("a", 0.9)], [], k=60)
    assert fused_k10[0]["fused_score"] > fused_k60[0]["fused_score"]
