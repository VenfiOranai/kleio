"""spells text to structured jsonb + spell slots

Revision ID: 2b9f4c1e0a3d
Revises: 1757898c7dd2
Create Date: 2026-07-11 12:10:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '2b9f4c1e0a3d'
down_revision: str | None = '1757898c7dd2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # spells: freeform text -> JSONB list of spell objects. Preserve any existing text as a
    # single seed spell so nothing is lost (per the blob->structured migration rule).
    op.add_column(
        "characters",
        sa.Column(
            "spells_structured",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        """
        UPDATE characters
        SET spells_structured = jsonb_build_array(
            jsonb_build_object(
                'name', 'Imported spells',
                'level', 0,
                'school', '',
                'prepared', false,
                'always_prepared', false,
                'ritual', false,
                'concentration', false,
                'casting_time', '',
                'range', '',
                'components', '',
                'duration', '',
                'description', spells
            )
        )
        WHERE spells IS NOT NULL AND btrim(spells) <> ''
        """
    )
    op.drop_column("characters", "spells")
    op.alter_column("characters", "spells_structured", new_column_name="spells")

    # Per-level spell-slot trackers: list of {level, total, expended}.
    op.add_column(
        "characters",
        sa.Column(
            "spell_slots",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("characters", "spell_slots")

    # Best-effort reverse: flatten spells back to text (name + description per line).
    op.add_column(
        "characters",
        sa.Column("spells_text", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(
        """
        UPDATE characters
        SET spells_text = COALESCE((
            SELECT string_agg(
                COALESCE(elem->>'name', '')
                || CASE WHEN COALESCE(elem->>'description', '') <> ''
                        THEN ': ' || (elem->>'description') ELSE '' END,
                E'\n'
            )
            FROM jsonb_array_elements(spells) AS elem
        ), '')
        """
    )
    op.drop_column("characters", "spells")
    op.alter_column("characters", "spells_text", new_column_name="spells", server_default=None)
