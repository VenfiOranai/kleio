"""features text to structured jsonb

Revision ID: 4d9f0a2b1c5e
Revises: 3c8e2f1a9b4d
Create Date: 2026-07-11 15:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '4d9f0a2b1c5e'
down_revision: str | None = '3c8e2f1a9b4d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # features: freeform text -> JSONB list of feature objects. Preserve any existing text as a
    # single seed feature so nothing is lost (per the blob->structured migration rule).
    op.add_column(
        "characters",
        sa.Column(
            "features_structured",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        """
        UPDATE characters
        SET features_structured = jsonb_build_array(
            jsonb_build_object(
                'name', 'Imported features',
                'source', 'other',
                'level', NULL,
                'uses', NULL,
                'description', features
            )
        )
        WHERE features IS NOT NULL AND btrim(features) <> ''
        """
    )
    op.drop_column("characters", "features")
    op.alter_column("characters", "features_structured", new_column_name="features")


def downgrade() -> None:
    # Best-effort reverse: flatten features back to text (name + description per line).
    op.add_column(
        "characters",
        sa.Column("features_text", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(
        """
        UPDATE characters
        SET features_text = COALESCE((
            SELECT string_agg(
                COALESCE(elem->>'name', '')
                || CASE WHEN COALESCE(elem->>'description', '') <> ''
                        THEN ': ' || (elem->>'description') ELSE '' END,
                E'\n'
            )
            FROM jsonb_array_elements(features) AS elem
        ), '')
        """
    )
    op.drop_column("characters", "features")
    op.alter_column("characters", "features_text", new_column_name="features", server_default=None)
