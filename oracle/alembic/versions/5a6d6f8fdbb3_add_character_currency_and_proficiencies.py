"""add character currency and other_proficiencies

Revision ID: 5a6d6f8fdbb3
Revises: 164e5aa4a525
Create Date: 2026-07-11 09:19:05.228874

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '5a6d6f8fdbb3'
down_revision: str | None = '164e5aa4a525'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "characters",
        sa.Column(
            "currency",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{\"cp\": 0, \"sp\": 0, \"ep\": 0, \"gp\": 0, \"pp\": 0}'::jsonb"),
        ),
    )
    op.add_column(
        "characters",
        sa.Column(
            "other_proficiencies",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("characters", "other_proficiencies")
    op.drop_column("characters", "currency")
