import pytest

from app.services.character_calc import (
    ability_modifier,
    compute_derived,
    proficiency_bonus,
)


@pytest.mark.parametrize(
    "score,expected",
    [(1, -5), (7, -2), (8, -1), (10, 0), (11, 0), (12, 1), (16, 3), (20, 5), (30, 10)],
)
def test_ability_modifier(score: int, expected: int):
    assert ability_modifier(score) == expected


@pytest.mark.parametrize(
    "level,expected",
    [(1, 2), (4, 2), (5, 3), (8, 3), (9, 4), (12, 4), (13, 5), (17, 6), (20, 6)],
)
def test_proficiency_bonus(level: int, expected: int):
    assert proficiency_bonus(level) == expected


def _abilities(**overrides: int) -> dict[str, int]:
    base = {
        "strength": 10,
        "dexterity": 10,
        "constitution": 10,
        "intelligence": 10,
        "wisdom": 10,
        "charisma": 10,
    }
    base.update(overrides)
    return base


def test_saving_throws_with_and_without_proficiency():
    derived = compute_derived(
        abilities=_abilities(dexterity=16),
        level=5,  # proficiency bonus 3
        saving_throw_proficiencies=["dexterity"],
        skill_proficiencies=[],
    )
    assert derived["proficiency_bonus"] == 3
    # DEX 16 -> +3 mod, proficient -> +3 pb = +6
    assert derived["saving_throws"]["dexterity"] == 6
    # STR 10 -> +0, not proficient -> +0
    assert derived["saving_throws"]["strength"] == 0


def test_skills_and_passive_perception():
    derived = compute_derived(
        abilities=_abilities(wisdom=14),
        level=1,  # pb 2
        saving_throw_proficiencies=[],
        skill_proficiencies=["perception"],
    )
    # WIS 14 -> +2, proficient perception -> +2 pb = +4
    assert derived["skills"]["perception"] == 4
    assert derived["passive_perception"] == 14  # 10 + 4
    # athletics uses STR 10 -> +0, not proficient
    assert derived["skills"]["athletics"] == 0


def test_initiative_is_dex_modifier():
    derived = compute_derived(
        abilities=_abilities(dexterity=18),
        level=1,
        saving_throw_proficiencies=[],
        skill_proficiencies=[],
    )
    assert derived["initiative"] == 4
