"""add entities and entity_groups (Codex)

Revision ID: 164e5aa4a525
Revises: 85a5f301d4ba
Create Date: 2026-07-04 16:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '164e5aa4a525'
down_revision: str | None = '85a5f301d4ba'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "entity_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "name", name="uq_entity_groups_campaign_name"),
    )
    op.create_index(
        op.f("ix_entity_groups_campaign_id"), "entity_groups", ["campaign_id"], unique=False
    )

    op.create_table(
        "entities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["entity_groups.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_entities_campaign_id"), "entities", ["campaign_id"], unique=False)
    op.create_index(op.f("ix_entities_group_id"), "entities", ["group_id"], unique=False)
    # Case-insensitive uniqueness per campaign (@[balrog] == @[Balrog]).
    op.create_index(
        "uq_entities_campaign_lower_name",
        "entities",
        ["campaign_id", sa.text("lower(name)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_entities_campaign_lower_name", table_name="entities")
    op.drop_index(op.f("ix_entities_group_id"), table_name="entities")
    op.drop_index(op.f("ix_entities_campaign_id"), table_name="entities")
    op.drop_table("entities")
    op.drop_index(op.f("ix_entity_groups_campaign_id"), table_name="entity_groups")
    op.drop_table("entity_groups")
