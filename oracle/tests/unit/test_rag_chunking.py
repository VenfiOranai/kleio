"""Unit tests for the pure chunking helper (no DB / no network)."""

from app.services import rag


def test_blank_text_yields_no_chunks():
    assert rag.chunk_text("") == []
    assert rag.chunk_text("   \n\n  ") == []


def test_short_notes_stay_one_chunk():
    assert rag.chunk_text("A short note about a dragon.") == ["A short note about a dragon."]


def test_paragraphs_pack_up_to_the_limit():
    paras = [f"Paragraph number {i} " + "word " * 20 for i in range(6)]
    text = "\n\n".join(paras)
    chunks = rag.chunk_text(text, max_chars=300, overlap=50)

    assert len(chunks) > 1
    assert all(len(c) <= 300 for c in chunks)
    # Every paragraph's marker survives somewhere (nothing dropped) and packing keeps order.
    joined = "\n\n".join(chunks)
    for i in range(6):
        assert f"Paragraph number {i}" in joined


def test_oversized_paragraph_is_split_with_overlap():
    para = "x" * 3000
    chunks = rag.chunk_text(para, max_chars=1000, overlap=200)

    assert all(len(c) <= 1000 for c in chunks)
    # Windows advance by (max - overlap) = 800, so 3000 chars → 4 windows.
    assert len(chunks) == 4
    # Reassembling with the 200-char overlap removed reproduces the original length.
    assert sum(len(c) for c in chunks) - 200 * (len(chunks) - 1) == 3000


def test_long_paragraph_flushes_pending_chunk_first():
    chunks = rag.chunk_text("short intro\n\n" + "y" * 1500, max_chars=1000, overlap=100)
    assert chunks[0] == "short intro"
    assert all(len(c) <= 1000 for c in chunks)
