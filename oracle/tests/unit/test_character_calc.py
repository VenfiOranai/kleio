import pytest

from app.services.character_calc import (
    ability_modifier,
    attack_stats,
    compute_derived,
    equipment_totals,
    proficiency_bonus,
    spellcasting_ability_for_class,
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


@pytest.mark.parametrize(
    "class_name,subclass,expected",
    [
        ("Wizard", "", "intelligence"),
        ("Artificer", "", "intelligence"),
        ("Cleric", "", "wisdom"),
        ("Druid", "", "wisdom"),
        ("Ranger", "", "wisdom"),
        ("Bard", "", "charisma"),
        ("Paladin", "", "charisma"),
        ("Sorcerer", "", "charisma"),
        ("Warlock", "", "charisma"),
        ("Barbarian", "", ""),
        ("Monk", "", ""),
        # Fighter/Rogue only cast via specific INT subclasses.
        ("Fighter", "Eldritch Knight", "intelligence"),
        ("Rogue", "Arcane Trickster", "intelligence"),
        ("Fighter", "Champion", ""),
        # Normalization: case + surrounding whitespace.
        ("WIZARD", "", "intelligence"),
        ("  wizard  ", "", "intelligence"),
        # Homebrew / unknown class → no spellcasting.
        ("Blood Hunter", "", ""),
        ("", "", ""),
    ],
)
def test_spellcasting_ability_for_class(class_name: str, subclass: str, expected: str):
    assert spellcasting_ability_for_class(class_name, subclass) == expected


def test_non_caster_class_gives_null_spell_stats():
    derived = compute_derived(
        abilities=_abilities(intelligence=18),
        level=5,
        saving_throw_proficiencies=[],
        skill_proficiencies=[],
        class_name="Barbarian",
    )
    assert derived["spellcasting_ability"] == ""
    assert derived["spell_attack_bonus"] is None
    assert derived["spell_save_dc"] is None


@pytest.mark.parametrize(
    "class_name,ability,score,level,exp_attack,exp_dc",
    [
        # Wizard (INT) 18 (+4), level 5 (pb +3): attack = 4+3=7, DC = 8+4+3=15
        ("Wizard", "intelligence", 18, 5, 7, 15),
        # Cleric (WIS) 16 (+3), level 1 (pb +2): attack = 3+2=5, DC = 8+3+2=13
        ("Cleric", "wisdom", 16, 1, 5, 13),
        # Sorcerer (CHA) 20 (+5), level 17 (pb +6): attack = 5+6=11, DC = 8+5+6=19
        ("Sorcerer", "charisma", 20, 17, 11, 19),
        # Negative mod: Wizard (INT) 8 (-1), level 1 (pb +2): attack = -1+2=1, DC = 8-1+2=9
        ("Wizard", "intelligence", 8, 1, 1, 9),
    ],
)
def test_spell_attack_and_save_dc(
    class_name: str, ability: str, score: int, level: int, exp_attack: int, exp_dc: int
):
    derived = compute_derived(
        abilities=_abilities(**{ability: score}),
        level=level,
        saving_throw_proficiencies=[],
        skill_proficiencies=[],
        class_name=class_name,
    )
    assert derived["spellcasting_ability"] == ability
    assert derived["spell_attack_bonus"] == exp_attack
    assert derived["spell_save_dc"] == exp_dc


def test_equipment_totals_weight_and_attunement():
    items = [
        {"name": "Longsword", "quantity": 1, "weight": 3, "attuned": False},
        {"name": "Rations", "quantity": 5, "weight": 2, "attuned": False},
        {"name": "Cloak of Protection", "quantity": 1, "weight": 1, "attuned": True},
        {"name": "Ring of X", "quantity": 1, "weight": None, "attuned": True},  # weightless
        {"name": "Torch", "quantity": 3},  # no weight key
    ]
    total_weight, attunement_count = equipment_totals(items)
    assert total_weight == 14  # 3 + 5*2 + 1 + 0 + 0
    assert attunement_count == 2


def test_equipment_totals_empty():
    assert equipment_totals([]) == (0, 0)


def test_derived_carry_weight_and_encumbrance():
    derived = compute_derived(
        abilities=_abilities(strength=10),  # carrying capacity 150
        level=1,
        saving_throw_proficiencies=[],
        skill_proficiencies=[],
        equipment=[{"name": "Anvil", "quantity": 1, "weight": 200, "attuned": True}],
    )
    assert derived["total_weight"] == 200
    assert derived["carrying_capacity"] == 150  # STR 10 × 15
    assert derived["encumbered"] is True
    assert derived["attunement_count"] == 1


def test_derived_defaults_to_no_equipment():
    derived = compute_derived(
        abilities=_abilities(strength=12),
        level=1,
        saving_throw_proficiencies=[],
        skill_proficiencies=[],
    )
    assert derived["total_weight"] == 0
    assert derived["carrying_capacity"] == 180
    assert derived["encumbered"] is False
    assert derived["attunement_count"] == 0
    assert derived["attacks"] == []


# --- Attacks -----------------------------------------------------------------


def _mods(**overrides: int) -> dict[str, int]:
    base = {name: 0 for name in ("strength", "dexterity", "constitution", "intelligence",
                                 "wisdom", "charisma")}
    base.update(overrides)
    return base


def test_attack_stats_proficient_str_weapon():
    # STR +3, proficiency +3, +1 magic bonus → to-hit +7; damage 1d8 + 3 (bonus not on damage).
    result = attack_stats(
        [{"name": "Longsword +1", "ability": "str", "proficient": True,
          "damage_dice": "1d8", "damage_type": "slashing", "bonus": 1}],
        mods=_mods(strength=3),
        proficiency=3,
        spellcasting_ability="",
    )
    assert result == [{"name": "Longsword +1", "to_hit": 7, "damage": "1d8 + 3"}]


def test_attack_stats_non_proficient_and_dex_finesse():
    # DEX +4 finesse dagger, NOT proficient → to-hit = 4 + 0 + 0; damage 1d4 + 4.
    result = attack_stats(
        [{"name": "Dagger", "ability": "dex", "proficient": False, "damage_dice": "1d4"}],
        mods=_mods(dexterity=4),
        proficiency=2,
        spellcasting_ability="",
    )
    assert result == [{"name": "Dagger", "to_hit": 4, "damage": "1d4 + 4"}]


def test_attack_stats_spellcasting_ability_and_negative_mod():
    # Spell attack uses the caster's ability (INT -1 here), proficient → to-hit = -1 + 2 = 1;
    # damage 1d10 - 1 (negative mod formats with a minus). A non-caster falls back to +0.
    caster = attack_stats(
        [{"name": "Fire Bolt", "ability": "spellcasting", "proficient": True,
          "damage_dice": "1d10"}],
        mods=_mods(intelligence=-1),
        proficiency=2,
        spellcasting_ability="intelligence",
    )
    assert caster == [{"name": "Fire Bolt", "to_hit": 1, "damage": "1d10 - 1"}]

    non_caster = attack_stats(
        [{"name": "Eldritch Blast", "ability": "spellcasting", "proficient": True}],
        mods=_mods(charisma=5),
        proficiency=3,
        spellcasting_ability="",  # class isn't a caster
    )
    assert non_caster == [{"name": "Eldritch Blast", "to_hit": 3, "damage": ""}]


def test_attack_stats_zero_mod_omits_damage_modifier():
    result = attack_stats(
        [{"name": "Club", "ability": "str", "proficient": True, "damage_dice": "1d4"}],
        mods=_mods(strength=0),
        proficiency=2,
        spellcasting_ability="",
    )
    assert result == [{"name": "Club", "to_hit": 2, "damage": "1d4"}]


def test_derived_includes_attack_to_hit_and_damage():
    # Wizard (INT caster) so a "spellcasting" attack resolves; STR 16 (+3), level 5 (pb +3).
    derived = compute_derived(
        abilities=_abilities(strength=16, intelligence=18),
        level=5,
        saving_throw_proficiencies=[],
        skill_proficiencies=[],
        class_name="Wizard",
        attacks=[
            {"name": "Quarterstaff", "ability": "str", "proficient": True, "damage_dice": "1d6"},
            {"name": "Fire Bolt", "ability": "spellcasting", "proficient": True,
             "damage_dice": "2d10"},
        ],
    )
    # STR +3 + pb +3 = +6; INT +4 + pb +3 = +7.
    assert derived["attacks"] == [
        {"name": "Quarterstaff", "to_hit": 6, "damage": "1d6 + 3"},
        {"name": "Fire Bolt", "to_hit": 7, "damage": "2d10 + 4"},
    ]
