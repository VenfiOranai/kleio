from datetime import datetime
from typing import TYPE_CHECKING

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.session import Session

# Embedding dimensionality. Fixed here (and in the migration) because the pgvector column
# width is part of the schema — changing it means a migration, not just a config flip. We ask
# Gemini for this many dimensions via ``output_dimensionality`` (see services/ai.EMBED_DIM).
EMBED_DIM = 768


class NoteEmbedding(Base):
    """One embedded chunk of a session's ``raw_notes`` — the retrieval unit for RAG Q&A.

    A session's notes are split into chunks; each chunk is embedded and stored here.
    ``campaign_id`` is denormalized from the parent session so retrieval can filter by
    campaign without a join. Rows are fully owned by the session: editing notes replaces
    them, deleting the session (or campaign) cascades them away."""

    __tablename__ = "note_embeddings"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBED_DIM))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["Session"] = relationship(back_populates="embeddings")
