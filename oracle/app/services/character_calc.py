"""Pure D&D 5E derived-stat math. No DB/IO — exhaustively unit-tested.

The backend is the single source of truth for derived character values; the frontend
may mirror this for live preview only.
"""

ABILITIES: tuple[str, ...] = (
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
)

# The 18 standard 5E skills mapped to their governing ability.
SKILLS: dict[str, str] = {
    "acrobatics": "dexterity",
    "animal_handling": "wisdom",
    "arcana": "intelligence",
    "athletics": "strength",
    "deception": "charisma",
    "history": "intelligence",
    "insight": "wisdom",
    "intimidation": "charisma",
    "investigation": "intelligence",
    "medicine": "wisdom",
    "nature": "intelligence",
    "perception": "wisdom",
    "performance": "charisma",
    "persuasion": "charisma",
    "religion": "intelligence",
    "sleight_of_hand": "dexterity",
    "stealth": "dexterity",
    "survival": "wisdom",
}


# 5E spellcasting ability is fixed by class.
CLASS_SPELLCASTING_ABILITY: dict[str, str] = {
    "artificer": "intelligence",
    "wizard": "intelligence",
    "cleric": "wisdom",
    "druid": "wisdom",
    "ranger": "wisdom",
    "bard": "charisma",
    "paladin": "charisma",
    "sorcerer": "charisma",
    "warlock": "charisma",
}

# Subclasses that grant spellcasting to an otherwise non-casting class (all use INT):
# Fighter's Eldritch Knight and Rogue's Arcane Trickster.
_SUBCLASS_INT_CASTERS: tuple[str, ...] = ("eldritch knight", "arcane trickster")


def spellcasting_ability_for_class(class_name: str, subclass: str = "") -> str:
    """Return the governing spellcasting ability for a class/subclass, or "" if none.

    Fixed by class in 5E: Artificer/Wizard → INT, Cleric/Druid/Ranger → WIS,
    Bard/Paladin/Sorcerer/Warlock → CHA. Fighter and Rogue only cast via the
    Eldritch Knight / Arcane Trickster subclasses (INT). Unknown/homebrew → "".
    """
    ability = CLASS_SPELLCASTING_ABILITY.get(class_name.strip().lower())
    if ability:
        return ability
    sub = subclass.strip().lower()
    if any(marker in sub for marker in _SUBCLASS_INT_CASTERS):
        return "intelligence"
    return ""


def ability_modifier(score: int) -> int:
    """5E ability modifier: floor((score - 10) / 2)."""
    return (score - 10) // 2


def proficiency_bonus(level: int) -> int:
    """5E proficiency bonus by level: 2 + floor((level - 1) / 4)."""
    return 2 + (max(level, 1) - 1) // 4


def compute_derived(
    *,
    abilities: dict[str, int],
    level: int,
    saving_throw_proficiencies: list[str],
    skill_proficiencies: list[str],
    class_name: str = "",
    subclass: str = "",
) -> dict:
    """Return all derived stats from the manually-entered inputs."""
    pb = proficiency_bonus(level)
    mods = {name: ability_modifier(abilities[name]) for name in ABILITIES}
    saves = {
        name: mods[name] + (pb if name in saving_throw_proficiencies else 0)
        for name in ABILITIES
    }
    skills = {
        skill: mods[ability] + (pb if skill in skill_proficiencies else 0)
        for skill, ability in SKILLS.items()
    }
    # Spellcasting ability is fixed by class; spell stats are defined only for casters.
    spellcasting_ability = spellcasting_ability_for_class(class_name, subclass)
    if spellcasting_ability in ABILITIES:
        sc_mod = mods[spellcasting_ability]
        spell_attack_bonus: int | None = sc_mod + pb
        spell_save_dc: int | None = 8 + sc_mod + pb
    else:
        spell_attack_bonus = None
        spell_save_dc = None
    return {
        "proficiency_bonus": pb,
        "ability_modifiers": mods,
        "saving_throws": saves,
        "skills": skills,
        "passive_perception": 10 + skills["perception"],
        "initiative": mods["dexterity"],
        "spellcasting_ability": spellcasting_ability,
        "spell_attack_bonus": spell_attack_bonus,
        "spell_save_dc": spell_save_dc,
    }
