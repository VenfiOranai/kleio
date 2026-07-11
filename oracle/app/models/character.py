from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.campaign import Campaign


def _default_currency() -> dict[str, int]:
    return {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}


class Character(Base):
    """A 5E-style character sheet. Only manually-entered fields are stored here;
    derived values (modifiers, saves, skills, ...) are computed in
    ``app.services.character_calc`` and never persisted."""

    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))

    # Identity
    class_name: Mapped[str] = mapped_column(String(100), default="")
    subclass: Mapped[str] = mapped_column(String(100), default="")
    level: Mapped[int] = mapped_column(Integer, default=1)
    race: Mapped[str] = mapped_column(String(100), default="")
    background: Mapped[str] = mapped_column(String(100), default="")
    alignment: Mapped[str] = mapped_column(String(50), default="")
    xp: Mapped[int] = mapped_column(Integer, default=0)

    # Ability scores (manual)
    strength: Mapped[int] = mapped_column(Integer, default=10)
    dexterity: Mapped[int] = mapped_column(Integer, default=10)
    constitution: Mapped[int] = mapped_column(Integer, default=10)
    intelligence: Mapped[int] = mapped_column(Integer, default=10)
    wisdom: Mapped[int] = mapped_column(Integer, default=10)
    charisma: Mapped[int] = mapped_column(Integer, default=10)

    # Combat (manual)
    max_hp: Mapped[int] = mapped_column(Integer, default=0)
    current_hp: Mapped[int] = mapped_column(Integer, default=0)
    temp_hp: Mapped[int] = mapped_column(Integer, default=0)
    hit_dice: Mapped[str] = mapped_column(String(50), default="")
    armor_class: Mapped[int] = mapped_column(Integer, default=10)
    speed: Mapped[int] = mapped_column(Integer, default=30)

    # Proficiency selections (lists of ability/skill keys)
    saving_throw_proficiencies: Mapped[list[str]] = mapped_column(JSONB, default=list)
    skill_proficiencies: Mapped[list[str]] = mapped_column(JSONB, default=list)

    # Money: {cp, sp, ep, gp, pp}
    currency: Mapped[dict[str, int]] = mapped_column(JSONB, default=_default_currency)
    # Misc proficiencies: list of {category, name}, category in language|weapon|armor|tool|other
    other_proficiencies: Mapped[list[dict[str, str]]] = mapped_column(JSONB, default=list)

    # Structured equipment: list of item dicts (see schemas.EquipmentItem).
    equipment: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Freeform notes (markdown)
    features: Mapped[str] = mapped_column(Text, default="")
    spells: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="characters")
