from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.services.character_calc import ABILITIES, compute_derived


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
    hit_dice: str = ""
    armor_class: int = 10
    speed: int = 30

    # Proficiency selections
    saving_throw_proficiencies: list[str] = Field(default_factory=list)
    skill_proficiencies: list[str] = Field(default_factory=list)

    # Freeform (markdown)
    equipment: str = ""
    features: str = ""
    spells: str = ""
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
    hit_dice: str | None = None
    armor_class: int | None = None
    speed: int | None = None
    saving_throw_proficiencies: list[str] | None = None
    skill_proficiencies: list[str] | None = None
    equipment: str | None = None
    features: str | None = None
    spells: str | None = None
    notes: str | None = None


class DerivedStats(BaseModel):
    proficiency_bonus: int
    ability_modifiers: dict[str, int]
    saving_throws: dict[str, int]
    skills: dict[str, int]
    passive_perception: int
    initiative: int


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
        )
        return DerivedStats(**stats)
