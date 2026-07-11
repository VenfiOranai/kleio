"""hit_dice text to structured jsonb pools

Revision ID: 3c8e2f1a9b4d
Revises: 2b9f4c1e0a3d
Create Date: 2026-07-11 13:30:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '3c8e2f1a9b4d'
down_revision: str | None = '2b9f4c1e0a3d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # hit_dice: freeform text (e.g. "3d8, 2d10") -> JSONB list of {die, total, spent} pools.
    # Best-effort parse of every "<n>d<m>" occurrence so multiclass dice survive; text with
    # no parseable die (empty or garbage) becomes an empty list.
    op.add_column(
        "characters",
        sa.Column(
            "hit_dice_structured",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        r"""
        UPDATE characters
        SET hit_dice_structured = COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'die', 'd' || m[2],
                    'total', (m[1])::int,
                    'spent', 0
                )
            )
            FROM regexp_matches(hit_dice, '(\d+)\s*[dD]\s*(\d+)', 'g') AS m
        ), '[]'::jsonb)
        WHERE hit_dice IS NOT NULL AND btrim(hit_dice) <> ''
        """
    )
    op.drop_column("characters", "hit_dice")
    op.alter_column("characters", "hit_dice_structured", new_column_name="hit_dice")


def downgrade() -> None:
    # Best-effort reverse: flatten pools back to a "<total><die>" comma-joined string.
    op.add_column(
        "characters",
        sa.Column("hit_dice_text", sa.String(length=50), nullable=False, server_default=""),
    )
    op.execute(
        """
        UPDATE characters
        SET hit_dice_text = COALESCE((
            SELECT string_agg((elem->>'total') || (elem->>'die'), ', ')
            FROM jsonb_array_elements(hit_dice) AS elem
        ), '')
        """
    )
    op.drop_column("characters", "hit_dice")
    op.alter_column("characters", "hit_dice_text", new_column_name="hit_dice", server_default=None)
