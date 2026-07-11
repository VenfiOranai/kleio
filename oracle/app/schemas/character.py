from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.services.character_calc import ABILITIES, compute_derived

ProficiencyCategory = Literal["language", "weapon", "armor", "tool", "other"]


class Currency(BaseModel):
    """Coin purse. All 5E coin denominations."""

    cp: int = 0
    sp: int = 0
    ep: int = 0
    gp: int = 0
    pp: int = 0


class OtherProficiency(BaseModel):
    """A misc proficiency (language, weapon, armor, tool, or other)."""

    category: ProficiencyCategory
    name: str


class EquipmentItem(BaseModel):
    """A carried item. Preset categories (Weapons/Armor/Gear/Consumables/Treasure/Other)
    are conventions the UI offers; ``category`` accepts any string for custom buckets."""

    name: str = ""
    quantity: int = 1
    category: str = "Gear"
    weight: float | None = None
    equipped: bool = False
    attuned: bool = False
    description: str = ""  # markdown


class Spell(BaseModel):
    """A known/prepared spell. ``level`` 0 is a cantrip. ``school`` is free-form (the UI
    offers the eight standard schools); all descriptive fields are optional strings."""

    name: str = ""
    level: int = Field(default=0, ge=0, le=9)
    school: str = ""
    prepared: bool = False
    always_prepared: bool = False  # e.g. domain/racial spells that don't count against prepared
    ritual: bool = False
    concentration: bool = False
    casting_time: str = ""
    range: str = ""
    components: str = ""
    duration: str = ""
    description: str = ""  # markdown


class SpellSlot(BaseModel):
    """Per-level spell-slot tracker. Manual for now (auto-from-class in Phase 14)."""

    level: int = Field(ge=1, le=9)
    total: int = 0
    expended: int = 0


class HitDie(BaseModel):
    """A pool of hit dice of one size (e.g. ``die="d8"``). ``spent`` are expended; a long
    rest restores up to half the pool (handled client-side). Multiclass characters have one
    entry per die size."""

    die: str = "d8"
    total: int = 0
    spent: int = 0


class CharacterBase(BaseModel):
    name: str

    # Identity
    class_name: str = ""
    subclass: str = ""
    level: int = 1
    race: str = ""
    background: str = ""
    alignment: str = ""
    xp: int = 0

    # Ability scores (manual)
    strength: int = 10
    dexterity: int = 10
    constitution: int = 10
    intelligence: int = 10
    wisdom: int = 10
    charisma: int = 10

    # Combat (manual)
    max_hp: int = 0
    current_hp: int = 0
    temp_hp: int = 0
    hit_dice: list[HitDie] = Field(default_factory=list)
    armor_class: int = 10
    speed: int = 30

    # Proficiency selections
    saving_throw_proficiencies: list[str] = Field(default_factory=list)
    skill_proficiencies: list[str] = Field(default_factory=list)

    # Money + misc proficiencies
    currency: Currency = Field(default_factory=Currency)
    other_proficiencies: list[OtherProficiency] = Field(default_factory=list)

    # Structured equipment
    equipment: list[EquipmentItem] = Field(default_factory=list)

    # Structured spells + per-level slot trackers
    spells: list[Spell] = Field(default_factory=list)
    spell_slots: list[SpellSlot] = Field(default_factory=list)

    # Freeform (markdown)
    features: str = ""
    notes: str = ""


class CharacterCreate(CharacterBase):
    pass


class CharacterUpdate(BaseModel):
    name: str | None = None
    class_name: str | None = None
    subclass: str | None = None
    level: int | None = None
    race: str | None = None
    background: str | None = None
    alignment: str | None = None
    xp: int | None = None
    strength: int | None = None
    dexterity: int | None = None
    constitution: int | None = None
    intelligence: int | None = None
    wisdom: int | None = None
    charisma: int | None = None
    max_hp: int | None = None
    current_hp: int | None = None
    temp_hp: int | None = None
    hit_dice: list[HitDie] | None = None
    armor_class: int | None = None
    speed: int | None = None
    saving_throw_proficiencies: list[str] | None = None
    skill_proficiencies: list[str] | None = None
    currency: Currency | None = None
    other_proficiencies: list[OtherProficiency] | None = None
    equipment: list[EquipmentItem] | None = None
    spells: list[Spell] | None = None
    spell_slots: list[SpellSlot] | None = None
    features: str | None = None
    notes: str | None = None


class DerivedStats(BaseModel):
    proficiency_bonus: int
    ability_modifiers: dict[str, int]
    saving_throws: dict[str, int]
    skills: dict[str, int]
    passive_perception: int
    initiative: int
    # Spellcasting ability derived from class ("" for non-casters); spell stats null then.
    spellcasting_ability: str
    spell_attack_bonus: int | None
    spell_save_dc: int | None
    # Equipment (Phase 9): carried weight vs STR-based carrying capacity, attuned-item count.
    total_weight: float
    carrying_capacity: int
    encumbered: bool
    attunement_count: int


class CharacterRead(CharacterBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def derived(self) -> DerivedStats:
        stats = compute_derived(
            abilities={name: getattr(self, name) for name in ABILITIES},
            level=self.level,
            saving_throw_proficiencies=self.saving_throw_proficiencies,
            skill_proficiencies=self.skill_proficiencies,
            class_name=self.class_name,
            subclass=self.subclass,
            equipment=[item.model_dump() for item in self.equipment],
        )
        return DerivedStats(**stats)
