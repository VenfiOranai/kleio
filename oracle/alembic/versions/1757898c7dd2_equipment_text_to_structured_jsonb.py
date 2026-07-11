"""equipment text to structured jsonb

Revision ID: 1757898c7dd2
Revises: 5a6d6f8fdbb3
Create Date: 2026-07-11 11:33:27.862470

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '1757898c7dd2'
down_revision: str | None = '5a6d6f8fdbb3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # equipment: freeform text -> JSONB list of item objects. Preserve any existing text as a
    # single seed item so nothing is lost (per the blob->structured migration rule).
    op.add_column(
        "characters",
        sa.Column(
            "equipment_items",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        """
        UPDATE characters
        SET equipment_items = jsonb_build_array(
            jsonb_build_object(
                'name', 'Imported equipment',
                'quantity', 1,
                'category', 'Other',
                'weight', NULL,
                'equipped', false,
                'attuned', false,
                'description', equipment
            )
        )
        WHERE equipment IS NOT NULL AND btrim(equipment) <> ''
        """
    )
    op.drop_column("characters", "equipment")
    op.alter_column("characters", "equipment_items", new_column_name="equipment")


def downgrade() -> None:
    # Best-effort reverse: flatten items back to text (name + description per line).
    op.add_column(
        "characters",
        sa.Column("equipment_text", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(
        """
        UPDATE characters
        SET equipment_text = COALESCE((
            SELECT string_agg(
                COALESCE(elem->>'name', '')
                || CASE WHEN COALESCE(elem->>'description', '') <> ''
                        THEN ': ' || (elem->>'description') ELSE '' END,
                E'\n'
            )
            FROM jsonb_array_elements(equipment) AS elem
        ), '')
        """
    )
    op.drop_column("characters", "equipment")
    op.alter_column("characters", "equipment_text", new_column_name="equipment", server_default=None)
