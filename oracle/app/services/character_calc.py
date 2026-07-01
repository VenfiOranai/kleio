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
    return {
        "proficiency_bonus": pb,
        "ability_modifiers": mods,
        "saving_throws": saves,
        "skills": skills,
        "passive_perception": 10 + skills["perception"],
        "initiative": mods["dexterity"],
    }
