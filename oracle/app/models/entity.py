from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    column,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.campaign import Campaign


class EntityGroup(Base):
    """A user-defined bucket for entities within a campaign ("Player Characters", "Places", …).

    Managed on the Codex page; deleting a group leaves its entities ungrouped
    (``Entity.group_id`` is set to NULL, not cascaded)."""

    __tablename__ = "entity_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="entity_groups")
    # On group delete the DB sets member entities' group_id to NULL (ON DELETE SET NULL);
    # passive_deletes lets that happen without SQLAlchemy loading + nulling them in Python.
    entities: Mapped[list["Entity"]] = relationship(
        back_populates="group", passive_deletes=True
    )

    __table_args__ = (
        UniqueConstraint("campaign_id", "name", name="uq_entity_groups_campaign_name"),
    )


class Entity(Base):
    """An "important word" tagged in notes via an ``@[Name]`` mention — a name, place, faction,
    item, etc. Referenced **by name** (the stable key), so ``name`` is unique per campaign
    case-insensitively. Deleting an entity leaves note text untouched."""

    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("entity_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="entities")
    group: Mapped["EntityGroup | None"] = relationship(back_populates="entities")

    # Case-insensitive uniqueness per campaign so @[balrog] and @[Balrog] don't fork.
    __table_args__ = (
        Index(
            "uq_entities_campaign_lower_name",
            "campaign_id",
            func.lower(column("name")),
            unique=True,
        ),
    )
