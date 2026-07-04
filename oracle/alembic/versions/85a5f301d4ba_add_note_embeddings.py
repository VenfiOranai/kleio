"""add note_embeddings (pgvector) for RAG Q&A

Revision ID: 85a5f301d4ba
Revises: 015bb0666895
Create Date: 2026-07-04 12:00:00.000000

"""
from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = '85a5f301d4ba'
down_revision: str | None = '015bb0666895'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Keep in sync with app.models.note_embedding.EMBED_DIM / app.services.ai.EMBED_DIM.
EMBED_DIM = 768


def upgrade() -> None:
    # pgvector's column type and operators require the extension. Needs the pgvector/pgvector
    # image (or the extension otherwise installed) — see infra/docker-compose*.yml.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "note_embeddings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(EMBED_DIM), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_note_embeddings_session_id"), "note_embeddings", ["session_id"], unique=False
    )
    op.create_index(
        op.f("ix_note_embeddings_campaign_id"), "note_embeddings", ["campaign_id"], unique=False
    )
    # HNSW index for approximate nearest-neighbour over cosine distance. HNSW builds without
    # training data (unlike IVFFlat), so it is safe to create on an empty table.
    op.execute(
        "CREATE INDEX ix_note_embeddings_embedding ON note_embeddings "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.drop_index("ix_note_embeddings_embedding", table_name="note_embeddings")
    op.drop_index(op.f("ix_note_embeddings_campaign_id"), table_name="note_embeddings")
    op.drop_index(op.f("ix_note_embeddings_session_id"), table_name="note_embeddings")
    op.drop_table("note_embeddings")
    # Leave the `vector` extension installed; other objects may rely on it.
