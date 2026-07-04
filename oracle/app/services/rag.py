"""Retrieval-augmented Q&A over session notes.

Splits notes into chunks, embeds them (via ``services.ai``) into the ``note_embeddings``
table, and answers questions by retrieving the nearest chunks for a campaign and feeding them
back to Gemini. ``chunk_text`` is pure (no DB/IO) and unit-tested; everything else takes a DB
session."""

import logging
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import joinedload

from app.models.note_embedding import NoteEmbedding
from app.models.session import Session
from app.services import ai

logger = logging.getLogger(__name__)

# Retrieval / chunking knobs. Chunks are a bit smaller than the model limit so a handful fit
# comfortably in one prompt; TOP_K balances recall against prompt size.
CHUNK_MAX_CHARS = 1200
CHUNK_OVERLAP = 150
TOP_K = 6
SNIPPET_CHARS = 240


@dataclass
class Citation:
    session_id: int
    title: str
    snippet: str


@dataclass
class RagAnswer:
    answer: str
    citations: list[Citation]


def chunk_text(
    text: str, *, max_chars: int = CHUNK_MAX_CHARS, overlap: int = CHUNK_OVERLAP
) -> list[str]:
    """Split ``text`` into retrieval-sized chunks. Pure and deterministic.

    Packs whole paragraphs (blank-line separated) greedily up to ``max_chars``; any single
    paragraph longer than ``max_chars`` is hard-split into overlapping character windows so no
    content is dropped. Returns non-empty, stripped chunks (``[]`` for blank input)."""
    text = (text or "").strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(para) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_split_long(para, max_chars, overlap))
            continue
        if not current:
            current = para
        elif len(current) + 2 + len(para) <= max_chars:
            current = f"{current}\n\n{para}"
        else:
            chunks.append(current)
            current = para
    if current:
        chunks.append(current)
    return chunks


def _split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    """Hard-split an over-long paragraph into overlapping windows."""
    step = max(1, max_chars - overlap)
    windows = [text[i : i + max_chars].strip() for i in range(0, len(text), step)]
    return [w for w in windows if w]


def reindex_session(db: DbSession, session: Session) -> None:
    """Replace the stored embeddings for ``session`` from its current ``raw_notes``.

    Embeds *before* deleting, so a failed embedding call leaves existing rows intact. Commits.
    Raises ``ai.AIError`` / ``ai.AINotConfiguredError`` on embedding failure."""
    chunks = chunk_text(session.raw_notes)
    vectors = ai.embed_texts(chunks) if chunks else []

    db.execute(delete(NoteEmbedding).where(NoteEmbedding.session_id == session.id))
    for index, (content, vector) in enumerate(zip(chunks, vectors, strict=True)):
        db.add(
            NoteEmbedding(
                session_id=session.id,
                campaign_id=session.campaign_id,
                chunk_index=index,
                content=content,
                embedding=vector,
            )
        )
    db.commit()


def reindex_session_safe(db: DbSession, session: Session) -> bool:
    """Best-effort ``reindex_session`` that never propagates AI errors.

    Called on every session save, where a missing key or a transient model error must not
    break the save. Returns whether reindexing succeeded."""
    try:
        reindex_session(db, session)
        return True
    except ai.AIError as exc:
        # Not configured, offline, quota, etc. — leave notes searchable-later, don't fail save.
        logger.info("Skipped embedding session %s: %s", session.id, exc)
        db.rollback()
        return False


def ensure_campaign_indexed(db: DbSession, campaign_id: int) -> None:
    """Embed any of the campaign's sessions that have notes but no stored embeddings yet.

    Bootstraps notes written before this feature (or while no key was configured). Raises on
    embedding failure so the caller can surface a 503/502."""
    indexed = select(NoteEmbedding.session_id).where(NoteEmbedding.campaign_id == campaign_id)
    stale = db.scalars(
        select(Session).where(
            Session.campaign_id == campaign_id,
            Session.raw_notes != "",
            Session.id.notin_(indexed),
        )
    ).all()
    for session in stale:
        reindex_session(db, session)


def retrieve(
    db: DbSession, campaign_id: int, query_vector: list[float], k: int = TOP_K
) -> list[NoteEmbedding]:
    """Return the ``k`` chunks in the campaign nearest to ``query_vector`` (cosine distance)."""
    stmt = (
        select(NoteEmbedding)
        .where(NoteEmbedding.campaign_id == campaign_id)
        .order_by(NoteEmbedding.embedding.cosine_distance(query_vector))
        .limit(k)
        .options(joinedload(NoteEmbedding.session))
    )
    return list(db.scalars(stmt).all())


def answer_campaign_question(db: DbSession, campaign_id: int, question: str) -> RagAnswer:
    """Index-on-demand, retrieve relevant chunks, and answer ``question`` with citations.

    Raises ``ai.AINotConfiguredError`` (no key) or ``ai.AIError`` (model failure)."""
    ensure_campaign_indexed(db, campaign_id)
    query_vector = ai.embed_query(question)
    rows = retrieve(db, campaign_id, query_vector)
    if not rows:
        return RagAnswer(
            answer="I couldn't find anything in this campaign's notes to answer that yet.",
            citations=[],
        )

    contexts = [f"[{row.session.title}]\n{row.content}" for row in rows]
    answer = ai.answer_question(question, contexts)
    return RagAnswer(answer=answer, citations=_citations(rows))


def _citations(rows: list[NoteEmbedding]) -> list[Citation]:
    """One citation per source session (best-ranked chunk wins), preserving retrieval order."""
    citations: list[Citation] = []
    seen: set[int] = set()
    for row in rows:
        if row.session_id in seen:
            continue
        seen.add(row.session_id)
        snippet = row.content.strip().replace("\n", " ")
        if len(snippet) > SNIPPET_CHARS:
            snippet = snippet[:SNIPPET_CHARS].rstrip() + "…"
        citations.append(
            Citation(session_id=row.session_id, title=row.session.title, snippet=snippet)
        )
    return citations
