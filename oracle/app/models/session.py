from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Computed, Date, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.campaign import Campaign

# Weighted full-text vector: title (A) ranks above summary (B) above raw notes (C).
# Generated/STORED so it stays in sync automatically; the two-arg to_tsvector is IMMUTABLE
# (a generated column requires it), unlike the config-less one-arg form.
_SEARCH_VECTOR_EXPR = (
    "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(summary, '')), 'B') || "
    "setweight(to_tsvector('english', coalesce(raw_notes, '')), 'C')"
)


class Session(Base):
    """A play session's notes, belonging to a campaign. ``raw_notes`` is the canonical
    text the user writes and is always preserved; ``summary`` is filled by Gemini later."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    session_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    raw_notes: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Derived, never hand-written: Postgres maintains it from title/summary/raw_notes.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed(_SEARCH_VECTOR_EXPR, persisted=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_sessions_search_vector", "search_vector", postgresql_using="gin"),
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="sessions")
