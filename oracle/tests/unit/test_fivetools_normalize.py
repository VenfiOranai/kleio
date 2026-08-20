"""Unit tests for the PURE 5etools → Kleio normalizers, against the fixture dataset."""

import json

import pytest

from app.services.fivetools import normalize
from tests.conftest import FIVETOOLS_FIXTURE_DIR


def _load(*parts: str) -> dict:
    with (FIVETOOLS_FIXTURE_DIR.joinpath(*parts)).open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def spells() -> dict[str, dict]:
    return {s["name"]: s for s in _load("spells", "spells-phb.json")["spell"]}


@pytest.fixture(scope="module")
def base_items() -> dict[str, dict]:
    return {i["name"]: i for i in _load("items-base.json")["baseitem"]}


@pytest.fixture(scope="module")
def variants() -> list[dict]:
    return _load("magicvariants.json")["magicvariant"]


@pytest.fixture(scope="module")
def generated(base_items, variants) -> dict[str, dict]:
    """Every specific magic item the fixture's variants produce, keyed by name."""
    expanded = normalize.expand_magic_variants(list(base_items.values()), variants)
    return {item["name"]: item for item in expanded}


# --- Spells ------------------------------------------------------------------


def test_spell_maps_onto_our_schema(spells):
    spell = normalize.normalize_spell(spells["Fireball"])
    assert spell["name"] == "Fireball"
    assert spell["level"] == 3
    assert spell["school"] == "Evocation"
    assert spell["casting_time"] == "1 action"
    assert spell["range"] == "150 feet"
    assert spell["components"] == "V, S, M (a tiny ball of bat guano and sulfur)"
    assert spell["duration"] == "Instantaneous"
    assert spell["ritual"] is False
    assert spell["concentration"] is False
    # Imported spells are never pre-flagged — preparing them is the player's call.
    assert spell["prepared"] is False and spell["always_prepared"] is False


def test_spell_description_is_markdown_with_tags_resolved(spells):
    description = normalize.normalize_spell(spells["Fireball"])["description"]
    assert "{@" not in description
    assert "DC 15" in description
    assert "8d6 fire damage" in description
    assert "**Ignition.** The fire spreads around corners and ignites *flammable objects*." in (
        description
    )


def test_at_higher_levels_drops_its_own_heading(spells):
    higher = normalize.normalize_spell(spells["Fireball"])["at_higher_levels"]
    assert higher.startswith("When you cast this spell using a slot of 4th level")
    assert "At Higher Levels" not in higher
    assert higher.endswith("increases by 1d6 for each slot level above 3rd.")


def test_ritual_concentration_and_shaped_range(spells):
    spell = normalize.normalize_spell(spells["Detect Magic"])
    assert spell["ritual"] is True
    assert spell["concentration"] is True
    assert spell["duration"] == "Concentration, up to 10 minutes"
    assert spell["range"] == "Self (30-foot sphere)"


def test_cantrip_facets(spells):
    facets = normalize.spell_facets(spells["Fire Bolt"])
    assert facets["level"] == 0
    assert facets["classes"] == ["Sorcerer", "Wizard"]
    assert facets["subtitle"] == "Cantrip Evocation · Sorcerer, Wizard"


def test_classes_from_the_newer_sources_file():
    entry = _load("spells", "sources.json")["PHB"]["Detect Magic"]
    # Subclass-only casters count too: Eldritch Knight ⇒ Fighter.
    assert normalize.classes_from_sources(entry) == ["Cleric", "Druid", "Fighter"]


@pytest.mark.parametrize(
    ("times", "expected"),
    [
        ([{"number": 1, "unit": "action"}], "1 action"),
        ([{"number": 1, "unit": "bonus"}], "1 bonus action"),
        ([{"number": 10, "unit": "minute"}], "10 minutes"),
        ([{"number": 1, "unit": "reaction", "condition": "which you take when hit"}],
         "1 reaction, which you take when hit"),
    ],
)
def test_casting_time_formats(times, expected):
    assert normalize.format_casting_time(times) == expected


@pytest.mark.parametrize(
    ("rng", "expected"),
    [
        ({"type": "point", "distance": {"type": "self"}}, "Self"),
        ({"type": "point", "distance": {"type": "touch"}}, "Touch"),
        ({"type": "point", "distance": {"type": "feet", "amount": 60}}, "60 feet"),
        ({"type": "point", "distance": {"type": "miles", "amount": 1}}, "1 mile"),
        ({"type": "radius", "distance": {"type": "feet", "amount": 15}}, "Self (15-foot radius)"),
        ({"type": "cone", "distance": {"type": "self"}}, "Self (cone)"),
        ({"type": "special"}, "Special"),
    ],
)
def test_range_formats(rng, expected):
    assert normalize.format_range(rng) == expected


# --- Items -------------------------------------------------------------------


def test_weapon_item_normalizes_with_a_stat_block(base_items):
    item = normalize.normalize_item(
        base_items["Longsword"], {"M": "Melee Weapon"}, {"V": "Versatile"}
    )
    assert item["name"] == "Longsword"
    assert item["category"] == "Weapons"
    assert item["quantity"] == 1
    assert item["weight"] == 3
    assert item["equipped"] is False and item["attuned"] is False
    assert "*Melee Weapon*" in item["description"]
    assert "**Damage** 1d8 slashing" in item["description"]
    assert "**Properties** Versatile (1d10)" in item["description"]
    assert "**Value** 15 gp" in item["description"]


def test_armor_item_shows_ac_and_penalties(base_items):
    description = normalize.normalize_item(base_items["Plate Armor"], {"HA": "Heavy Armor"})[
        "description"
    ]
    assert "**Armor Class** 18" in description
    assert "**Strength** 15" in description
    assert "**Stealth** disadvantage" in description


def test_categories_bucket_into_the_sheets_presets(base_items):
    assert normalize.item_category(base_items["Dagger"]) == "Weapons"
    assert normalize.item_category(base_items["Plate Armor"]) == "Armor"
    assert normalize.item_category(base_items["Rope, Hempen (50 feet)"]) == "Gear"
    assert normalize.item_category({"type": "P"}) == "Consumables"
    assert normalize.item_category({"type": "$"}) == "Treasure"
    assert normalize.item_category({"wondrous": True}) == "Gear"


def test_attunement_and_value_formatting():
    assert normalize.attunement_text({"reqAttune": True}) == "requires attunement"
    assert (
        normalize.attunement_text({"reqAttune": "by a wizard"})
        == "requires attunement by a wizard"
    )
    assert normalize.attunement_text({}) == ""
    assert normalize.format_value(1500) == "15 gp"
    assert normalize.format_value(200) == "2 gp"
    assert normalize.format_value(50) == "5 sp"
    assert normalize.format_value(7) == "7 cp"
    assert normalize.format_value(None) == ""


def test_weapon_becomes_a_ready_to_add_attack(base_items):
    attack = normalize.weapon_attack(
        base_items["Dagger"], None, {"F": "Finesse", "L": "Light", "T": "Thrown"}
    )
    assert attack["name"] == "Dagger"
    assert attack["ability"] == "dex"  # finesse
    assert attack["proficient"] is True
    assert attack["damage_dice"] == "1d4"
    assert attack["damage_type"] == "piercing"
    assert attack["range"] == "5 ft."
    assert attack["notes"] == "Finesse, Light, Thrown (20/60 ft.)"
    assert attack["source"] == "weapon"
    assert attack["bonus"] is None


def test_non_weapons_have_no_attack(base_items):
    assert normalize.weapon_attack(base_items["Rope, Hempen (50 feet)"]) is None


def test_item_facets_expose_what_the_browser_filters_on(base_items):
    facets = normalize.item_facets(base_items["Longsword"], {"M": "Melee Weapon"})
    assert facets == {
        "category": "Weapons",
        "rarity": "none",
        "value": 1500,
        "weight": 3,
        "attunement": False,
        "weapon": True,
        "subtitle": "Melee Weapon · 15 gp",
    }


# --- Item assembly -----------------------------------------------------------


def test_copy_items_inherit_their_parents_fields():
    items = _load("items.json")["item"]
    resolved = {i["name"]: i for i in normalize.resolve_copies(items)}
    greater = resolved["Potion of Greater Healing"]
    assert greater["type"] == "P"  # inherited
    assert greater["weight"] == 0.5  # inherited
    assert greater["rarity"] == "uncommon"  # own field wins
    assert greater["value"] == 15000
    assert "_copy" not in greater


def test_magic_variants_are_crossed_with_matching_base_items(generated):
    # `requires: [{weapon: true}]` hits both weapons…
    assert "+1 Longsword" in generated
    assert "+1 Dagger" in generated
    # …but `excludes: {net: true}` drops the net, and non-weapons never matched.
    assert "+1 Net" not in generated
    assert "+1 Shield" not in generated
    # `requires: [{type: HA}, {type: MA}]` is an OR of alternatives — plate is heavy armor.
    assert "Adamantine Plate Armor" in generated


def test_a_generated_variant_keeps_the_base_stats_and_resolves_templating(generated):
    plus_one = generated["+1 Longsword"]
    assert plus_one["dmg1"] == "1d8"  # from the base item
    assert plus_one["rarity"] == "uncommon"  # from the variant
    assert plus_one["source"] == "DMG"
    assert plus_one["baseItem"] == "Longsword|PHB"
    assert plus_one["entries"] == [
        "You have a +1 bonus to attack and damage rolls made with this magic weapon."
    ]
    # `{=baseName/l}` lower-cases the base item's name.
    assert generated["Adamantine Plate Armor"]["entries"] == [
        "This suit of plate armor is reinforced with adamantine."
    ]


def test_generated_variant_carries_its_bonus_into_the_attack(generated):
    attack = normalize.weapon_attack(generated["+1 Longsword"])
    assert attack["bonus"] == 1
    assert attack["damage_dice"] == "1d8"


# --- Features ----------------------------------------------------------------


def test_feat_normalizes_with_its_prerequisite():
    feat = next(f for f in _load("feats.json")["feat"] if f["name"] == "Grappler")
    feature = normalize.normalize_feat(feat)
    assert feature["source"] == "feat"
    assert feature["level"] is None and feature["uses"] is None
    assert feature["description"].startswith("*Prerequisite: Strength 13*")
    assert "- You have advantage on attack rolls" in feature["description"]
    assert "*skills*" in feature["description"]  # {@i} resolved


def test_feat_without_prerequisite_has_no_prerequisite_line():
    feat = next(f for f in _load("feats.json")["feat"] if f["name"] == "Alert")
    assert not normalize.normalize_feat(feat)["description"].startswith("*Prerequisite")


def test_optional_features_are_class_features_with_a_kind():
    raw = _load("optionalfeatures.json")["optionalfeature"][0]
    assert normalize.optional_feature_kind(raw) == "Eldritch Invocation"
    feature = normalize.normalize_optional_feature(raw)
    assert feature["source"] == "class"
    assert feature["description"].startswith("*Prerequisite: Eldritch Blast spell*")
    assert "add your Charisma modifier" in feature["description"]


@pytest.mark.parametrize(
    ("prerequisite", "expected"),
    [
        ([{"level": 4}], "level 4"),
        ([{"level": {"level": 2, "class": {"name": "Warlock"}}}], "Warlock level 2"),
        ([{"ability": [{"str": 13}]}, {"ability": [{"dex": 13}]}], "Strength 13 or Dexterity 13"),
        ([{"race": [{"name": "elf", "subrace": "high"}]}], "high elf"),
        ([{"spellcasting": True}], "the ability to cast at least one spell"),
        ([{"pact": "Chain"}], "Pact of the Chain"),
        ([{"proficiency": [{"armor": "heavy"}]}], "armor heavy proficiency"),
        ([{"other": "a {@item shield|phb}"}], "a shield"),
        ([], ""),
    ],
)
def test_prerequisite_formatting(prerequisite, expected):
    assert normalize.format_prerequisites(prerequisite) == expected
