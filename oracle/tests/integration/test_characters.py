from fastapi.testclient import TestClient


def test_create_character_computes_derived(db_client: TestClient, campaign_id: int):
    payload = {
        "name": "Aria",
        "level": 5,  # proficiency bonus 3
        "strength": 16,  # +3
        "dexterity": 14,  # +2
        "wisdom": 12,  # +1
        "saving_throw_proficiencies": ["dexterity"],
        "skill_proficiencies": ["perception", "stealth"],
    }
    resp = db_client.post(f"/api/campaigns/{campaign_id}/characters", json=payload)
    assert resp.status_code == 201
    derived = resp.json()["derived"]

    assert derived["proficiency_bonus"] == 3
    assert derived["ability_modifiers"]["strength"] == 3
    assert derived["saving_throws"]["dexterity"] == 5  # +2 mod + 3 proficiency
    assert derived["saving_throws"]["strength"] == 3  # +3 mod, not proficient
    assert derived["skills"]["stealth"] == 5  # DEX +2 + 3 proficiency
    assert derived["skills"]["perception"] == 4  # WIS +1 + 3 proficiency
    assert derived["passive_perception"] == 14  # 10 + 4
    assert derived["initiative"] == 2  # DEX +2


def test_update_character_recomputes_derived(db_client: TestClient, campaign_id: int):
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters",
        json={"name": "Bran", "level": 1, "dexterity": 10},
    ).json()["id"]

    resp = db_client.put(f"/api/characters/{character_id}", json={"dexterity": 20})
    assert resp.status_code == 200
    derived = resp.json()["derived"]
    assert derived["ability_modifiers"]["dexterity"] == 5
    assert derived["initiative"] == 5


def test_currency_proficiencies_and_class_derived_spellcasting(
    db_client: TestClient, campaign_id: int
):
    payload = {
        "name": "Elora",
        "class_name": "Wizard",  # → spellcasting ability INT
        "level": 5,  # proficiency bonus 3
        "intelligence": 18,  # +4
        "currency": {"cp": 5, "sp": 0, "ep": 0, "gp": 42, "pp": 1},
        "other_proficiencies": [
            {"category": "language", "name": "Draconic"},
            {"category": "tool", "name": "Thieves' Tools"},
        ],
    }
    resp = db_client.post(f"/api/campaigns/{campaign_id}/characters", json=payload)
    assert resp.status_code == 201
    body = resp.json()

    # Stored fields round-trip.
    assert body["currency"] == {"cp": 5, "sp": 0, "ep": 0, "gp": 42, "pp": 1}
    assert body["other_proficiencies"] == payload["other_proficiencies"]

    # Spellcasting ability comes from the class; INT +4, pb +3 -> attack 7, DC 15.
    assert body["derived"]["spellcasting_ability"] == "intelligence"
    assert body["derived"]["spell_attack_bonus"] == 7
    assert body["derived"]["spell_save_dc"] == 15


def test_non_caster_class_has_null_spell_stats_and_default_currency(
    db_client: TestClient, campaign_id: int
):
    body = db_client.post(
        f"/api/campaigns/{campaign_id}/characters",
        json={"name": "Grunk", "class_name": "Barbarian"},
    ).json()
    assert body["derived"]["spellcasting_ability"] == ""
    assert body["derived"]["spell_attack_bonus"] is None
    assert body["derived"]["spell_save_dc"] is None
    assert body["currency"] == {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
    assert body["other_proficiencies"] == []


def test_subclass_grants_spellcasting(db_client: TestClient, campaign_id: int):
    # An Eldritch Knight fighter casts with INT even though the base class doesn't.
    body = db_client.post(
        f"/api/campaigns/{campaign_id}/characters",
        json={
            "name": "Kael",
            "class_name": "Fighter",
            "subclass": "Eldritch Knight",
            "level": 8,  # pb +3
            "intelligence": 16,  # +3
        },
    ).json()
    assert body["derived"]["spellcasting_ability"] == "intelligence"
    assert body["derived"]["spell_save_dc"] == 14  # 8 + 3 + 3
    assert body["derived"]["spell_attack_bonus"] == 6  # 3 + 3


def test_equipment_round_trips_and_derives_weight(db_client: TestClient, campaign_id: int):
    payload = {
        "name": "Packmule",
        "strength": 14,  # carrying capacity 210
        "equipment": [
            {"name": "Plate Armor", "quantity": 1, "category": "Armor", "weight": 65,
             "equipped": True, "attuned": False, "description": "AC 18"},
            {"name": "Rations", "quantity": 10, "category": "Consumables", "weight": 2},
            {"name": "Amulet of Health", "quantity": 1, "category": "Treasure",
             "weight": 1, "attuned": True},
        ],
    }
    body = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json=payload
    ).json()

    # List round-trips with defaults filled in (quantity/category/flags).
    assert len(body["equipment"]) == 3
    assert body["equipment"][0]["name"] == "Plate Armor"
    assert body["equipment"][1]["quantity"] == 10
    assert body["equipment"][1]["equipped"] is False  # default

    # Derived: 65 + 10*2 + 1 = 86 weight; STR 14 → capacity 210 (not encumbered); 1 attuned.
    d = body["derived"]
    assert d["total_weight"] == 86
    assert d["carrying_capacity"] == 210
    assert d["encumbered"] is False
    assert d["attunement_count"] == 1


def test_equipment_defaults_to_empty_list(db_client: TestClient, campaign_id: int):
    body = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Naked"}
    ).json()
    assert body["equipment"] == []
    assert body["derived"]["total_weight"] == 0
    assert body["derived"]["attunement_count"] == 0


def test_spells_and_slots_round_trip(db_client: TestClient, campaign_id: int):
    payload = {
        "name": "Elora",
        "class_name": "Wizard",
        "spells": [
            {"name": "Fire Bolt", "level": 0, "school": "Evocation"},
            {
                "name": "Shield",
                "level": 1,
                "school": "Abjuration",
                "prepared": True,
                "ritual": False,
                "casting_time": "1 reaction",
                "range": "Self",
                "components": "V, S",
                "duration": "1 round",
                "description": "+5 AC until your next turn.",
            },
            {
                "name": "Detect Magic",
                "level": 1,
                "ritual": True,
                "concentration": True,
                "always_prepared": True,
            },
        ],
        "spell_slots": [
            {"level": 1, "total": 4, "expended": 1},
            {"level": 2, "total": 2, "expended": 0},
        ],
    }
    body = db_client.post(f"/api/campaigns/{campaign_id}/characters", json=payload).json()

    assert len(body["spells"]) == 3
    # Defaults fill in for the terse cantrip.
    assert body["spells"][0]["name"] == "Fire Bolt"
    assert body["spells"][0]["prepared"] is False
    assert body["spells"][1]["prepared"] is True
    assert body["spells"][2]["ritual"] is True
    assert body["spells"][2]["concentration"] is True

    assert body["spell_slots"] == [
        {"level": 1, "total": 4, "expended": 1},
        {"level": 2, "total": 2, "expended": 0},
    ]


def test_spells_default_to_empty_and_cast_persists(db_client: TestClient, campaign_id: int):
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Blank"}
    ).json()["id"]
    created = db_client.get(f"/api/characters/{character_id}").json()
    assert created["spells"] == []
    assert created["spell_slots"] == []

    # "Casting" a spell (expending a slot) is client-side state that persists on save.
    body = db_client.put(
        f"/api/characters/{character_id}",
        json={"spell_slots": [{"level": 1, "total": 3, "expended": 2}]},
    ).json()
    assert body["spell_slots"] == [{"level": 1, "total": 3, "expended": 2}]


def test_spell_level_out_of_range_rejected(db_client: TestClient, campaign_id: int):
    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/characters",
        json={"name": "Bad", "spells": [{"name": "Wish", "level": 10}]},
    )
    assert resp.status_code == 422


def test_hit_dice_round_trip_and_default_empty(db_client: TestClient, campaign_id: int):
    # Defaults to an empty list of pools.
    blank = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Blank"}
    ).json()
    assert blank["hit_dice"] == []

    # Multiclass pools (with spent tracking) round-trip; defaults fill in.
    payload = {
        "name": "Multiclass",
        "hit_dice": [
            {"die": "d8", "total": 3, "spent": 1},
            {"die": "d10", "total": 2},  # spent defaults to 0
        ],
    }
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json=payload
    ).json()["id"]
    fetched = db_client.get(f"/api/characters/{character_id}").json()
    assert fetched["hit_dice"] == [
        {"die": "d8", "total": 3, "spent": 1},
        {"die": "d10", "total": 2, "spent": 0},
    ]

    # Spending / restoring hit dice is client-side state that persists on save.
    body = db_client.put(
        f"/api/characters/{character_id}",
        json={"hit_dice": [{"die": "d8", "total": 3, "spent": 0}]},
    ).json()
    assert body["hit_dice"] == [{"die": "d8", "total": 3, "spent": 0}]


def test_features_round_trip_and_default_empty(db_client: TestClient, campaign_id: int):
    # Defaults to an empty list.
    blank = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Blank"}
    ).json()
    assert blank["features"] == []

    payload = {
        "name": "Grog",
        "features": [
            {
                "name": "Rage",
                "source": "class",
                "level": 1,
                "uses": {"max": 3, "expended": 1, "recharge": "long"},
                "description": "Advantage on STR checks and saves.",
            },
            {"name": "Darkvision", "source": "race"},  # passive: no uses
        ],
    }
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json=payload
    ).json()["id"]
    fetched = db_client.get(f"/api/characters/{character_id}").json()

    assert len(fetched["features"]) == 2
    assert fetched["features"][0]["uses"] == {"max": 3, "expended": 1, "recharge": "long"}
    # Defaults fill in for the terse passive trait.
    assert fetched["features"][1]["source"] == "race"
    assert fetched["features"][1]["level"] is None
    assert fetched["features"][1]["uses"] is None

    # Expending a use is client-side state that persists on save.
    body = db_client.put(
        f"/api/characters/{character_id}",
        json={
            "features": [
                {
                    "name": "Rage",
                    "source": "class",
                    "uses": {"max": 3, "expended": 3, "recharge": "long"},
                }
            ]
        },
    ).json()
    assert body["features"][0]["uses"]["expended"] == 3


def test_feature_invalid_source_rejected(db_client: TestClient, campaign_id: int):
    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/characters",
        json={"name": "Bad", "features": [{"name": "Nope", "source": "deity"}]},
    )
    assert resp.status_code == 422


def test_list_and_delete_character(db_client: TestClient, campaign_id: int):
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Cora"}
    ).json()["id"]

    listing = db_client.get(f"/api/campaigns/{campaign_id}/characters")
    assert len(listing.json()) == 1

    assert db_client.delete(f"/api/characters/{character_id}").status_code == 204
    assert db_client.get(f"/api/characters/{character_id}").status_code == 404
