"""Unit tests for the reference index: loading the dataset once, then searching it."""

import pytest

from app.services import fivetools
from app.services.fivetools import index as index_module


@pytest.fixture
def index(fivetools_data):
    return fivetools.get_index()


def names(entries) -> list[str]:
    return [e.name for e in entries]


# --- Loading -----------------------------------------------------------------


def test_unconfigured_dataset_is_unavailable(no_fivetools_data):
    with pytest.raises(fivetools.ReferenceUnavailable):
        fivetools.get_index()
    assert fivetools.is_available() is False


def test_missing_directory_is_unavailable(monkeypatch, tmp_path, no_fivetools_data):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "fivetools_data_dir", str(tmp_path / "nope"))
    fivetools.reset_cache()
    with pytest.raises(fivetools.ReferenceUnavailable):
        fivetools.get_index()
    fivetools.reset_cache()


def test_data_dir_may_point_at_the_repo_root(monkeypatch, tmp_path, no_fivetools_data):
    """A 5etools checkout keeps everything under `data/` — accept either level."""
    from app.core.config import get_settings

    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "feats.json").write_text('{"feat": []}', encoding="utf-8")
    monkeypatch.setattr(get_settings(), "fivetools_data_dir", str(tmp_path))
    fivetools.reset_cache()
    assert fivetools.get_index().data_dir.name == "data"
    fivetools.reset_cache()


def test_dataset_is_parsed_once_and_cached(fivetools_data, monkeypatch):
    first = fivetools.get_index()
    # A second call must not touch the filesystem again.
    monkeypatch.setattr(
        index_module, "_read_json", lambda path: pytest.fail("re-read the dataset")
    )
    assert fivetools.get_index() is first


def test_index_counts_every_type(index):
    counts = index.counts()
    assert counts["spell"] == 3
    assert counts["feature"] == 4  # 2 feats + 2 optional features
    # 6 base items + 3 items + 1 item group + 3 generated magic variants.
    assert counts["item"] == 13


def test_item_metadata_comes_from_the_dataset(index):
    assert index.item_type_names["M"] == "Melee Weapon"
    assert index.item_property_names["V"] == "Versatile"


# --- Searching ---------------------------------------------------------------


def test_search_matches_names_case_insensitively(index):
    _, results = fivetools.search(index, fivetools.SearchQuery(type="spell", q="FIRE"))
    assert names(results) == ["Fire Bolt", "Fireball"]


def test_relevance_puts_prefix_matches_first(index):
    _, results = fivetools.search(index, fivetools.SearchQuery(type="item", q="long"))
    # "Longsword" starts with the needle; "+1 Longsword" only starts a later word with it —
    # alphabetical order alone would have put the "+1" first.
    assert names(results) == ["Longsword", "+1 Longsword"]


def test_search_returns_the_total_alongside_the_page(index):
    total, results = fivetools.search(index, fivetools.SearchQuery(type="item", limit=2))
    assert total == 13
    assert len(results) == 2
    _, page_two = fivetools.search(index, fivetools.SearchQuery(type="item", limit=2, offset=2))
    assert not set(names(results)) & set(names(page_two))


def test_spell_filters(index):
    _, by_level = fivetools.search(index, fivetools.SearchQuery(type="spell", level=[0, 1]))
    assert names(by_level) == ["Detect Magic", "Fire Bolt"]

    _, by_school = fivetools.search(index, fivetools.SearchQuery(type="spell", school="Evocation"))
    assert names(by_school) == ["Fire Bolt", "Fireball"]

    _, rituals = fivetools.search(index, fivetools.SearchQuery(type="spell", ritual=True))
    assert names(rituals) == ["Detect Magic"]

    _, concentration = fivetools.search(
        index, fivetools.SearchQuery(type="spell", concentration=True)
    )
    assert names(concentration) == ["Detect Magic"]


def test_spell_class_filter_uses_the_sources_file_fallback(index):
    _, cleric = fivetools.search(index, fivetools.SearchQuery(type="spell", class_name="Cleric"))
    assert names(cleric) == ["Detect Magic"]
    _, wizard = fivetools.search(index, fivetools.SearchQuery(type="spell", class_name="Wizard"))
    assert names(wizard) == ["Fire Bolt", "Fireball"]


def test_item_filters(index):
    _, weapons = fivetools.search(index, fivetools.SearchQuery(type="item", weapons_only=True))
    assert "Longsword" in names(weapons) and "Shield" not in names(weapons)

    _, armor = fivetools.search(index, fivetools.SearchQuery(type="item", category="Armor"))
    assert set(names(armor)) == {"Adamantine Plate Armor", "Plate Armor", "Shield"}

    _, rare = fivetools.search(index, fivetools.SearchQuery(type="item", rarity="very rare"))
    assert names(rare) == ["Staff of Fire"]

    _, attuned = fivetools.search(index, fivetools.SearchQuery(type="item", attunement=True))
    assert set(names(attuned)) == {"Bag of Tricks", "Staff of Fire"}


def test_feature_kind_filter(index):
    _, feats = fivetools.search(index, fivetools.SearchQuery(type="feature", kind="Feat"))
    assert names(feats) == ["Alert", "Grappler"]
    _, invocations = fivetools.search(
        index, fivetools.SearchQuery(type="feature", kind="Eldritch Invocation")
    )
    assert names(invocations) == ["Agonizing Blast"]


def test_sorting(index):
    _, by_level = fivetools.search(index, fivetools.SearchQuery(type="spell", sort="level"))
    assert names(by_level) == ["Fire Bolt", "Detect Magic", "Fireball"]

    _, descending = fivetools.search(
        index, fivetools.SearchQuery(type="spell", sort="level", direction="desc")
    )
    assert names(descending) == ["Fireball", "Detect Magic", "Fire Bolt"]

    _, by_value = fivetools.search(
        index, fivetools.SearchQuery(type="item", sort="value", direction="desc", limit=1)
    )
    assert names(by_value) == ["Plate Armor"]

    _, by_rarity = fivetools.search(
        index, fivetools.SearchQuery(type="item", sort="rarity", direction="desc", limit=1)
    )
    assert names(by_rarity) == ["Staff of Fire"]  # the only "very rare" one


def test_facets_list_only_what_the_dataset_holds(index):
    spells = fivetools.facets(index, "spell")
    assert spells["levels"] == [0, 1, 3]
    assert spells["schools"] == ["Divination", "Evocation"]
    assert spells["classes"] == ["Cleric", "Druid", "Fighter", "Sorcerer", "Wizard"]
    assert "level" in spells["sorts"]

    items = fivetools.facets(index, "item")
    assert items["categories"] == ["Armor", "Consumables", "Gear", "Weapons"]
    # Rarities come back in game order, not alphabetically.
    assert items["rarities"] == ["none", "common", "uncommon", "very rare"]

    assert fivetools.facets(index, "feature")["kinds"] == [
        "Eldritch Invocation",
        "Feat",
        "Metamagic",
    ]


# --- Full records ------------------------------------------------------------


def test_record_for_a_spell_is_sheet_shaped(index):
    _, [entry] = fivetools.search(index, fivetools.SearchQuery(type="spell", q="fireball"))
    record = fivetools.normalized_record(index, entry)
    assert record["type"] == "spell"
    assert record["item"] is None and record["feature"] is None and record["attack"] is None
    assert record["spell"]["level"] == 3
    assert record["spell"]["school"] == "Evocation"


def test_record_for_a_weapon_carries_an_attack_row(index):
    _, [entry] = fivetools.search(index, fivetools.SearchQuery(type="item", q="+1 Longsword"))
    record = fivetools.normalized_record(index, entry)
    assert record["item"]["category"] == "Weapons"
    assert record["attack"]["damage_dice"] == "1d8"
    assert record["attack"]["bonus"] == 1
    # Property names resolved from the dataset's own metadata.
    assert "Versatile (1d10)" in record["item"]["description"]


def test_record_for_a_non_weapon_item_has_no_attack(index):
    _, [entry] = fivetools.search(index, fivetools.SearchQuery(type="item", q="Potion of Healing"))
    record = fivetools.normalized_record(index, entry)
    assert record["attack"] is None
    assert record["item"]["category"] == "Consumables"


def test_record_for_a_feature_picks_the_right_source(index):
    _, [feat] = fivetools.search(index, fivetools.SearchQuery(type="feature", q="Grappler"))
    assert fivetools.normalized_record(index, feat)["feature"]["source"] == "feat"
    _, [invocation] = fivetools.search(
        index, fivetools.SearchQuery(type="feature", q="Agonizing Blast")
    )
    assert fivetools.normalized_record(index, invocation)["feature"]["source"] == "class"


def test_ids_are_stable_and_resolvable(index):
    _, [entry] = fivetools.search(index, fivetools.SearchQuery(type="spell", q="fireball"))
    assert entry.id == "spell-fireball-phb"
    assert fivetools.get_entry(index, entry.id) is entry
    assert fivetools.get_entry(index, "spell-nope") is None
