"""add character attacks

Revision ID: 5e1f2a3b4c6d
Revises: 4d9f0a2b1c5e
Create Date: 2026-07-11 16:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '5e1f2a3b4c6d'
down_revision: str | None = '4d9f0a2b1c5e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # attacks is a brand-new structured column (no prior freeform field to preserve).
    op.add_column(
        "characters",
        sa.Column(
            "attacks",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("characters", "attacks")
