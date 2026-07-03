"""add session search_vector

Revision ID: 015bb0666895
Revises: 0192ab3b848c
Create Date: 2026-07-03 20:50:15.688938

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '015bb0666895'
down_revision: str | None = '0192ab3b848c'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Keep in sync with Session._SEARCH_VECTOR_EXPR (weighted: title A > summary B > raw_notes C).
_SEARCH_VECTOR_EXPR = (
    "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(summary, '')), 'B') || "
    "setweight(to_tsvector('english', coalesce(raw_notes, '')), 'C')"
)


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed(_SEARCH_VECTOR_EXPR, persisted=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_sessions_search_vector",
        "sessions",
        ["search_vector"],
        unique=False,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_search_vector", table_name="sessions")
    op.drop_column("sessions", "search_vector")
