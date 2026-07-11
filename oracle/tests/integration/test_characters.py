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


def test_list_and_delete_character(db_client: TestClient, campaign_id: int):
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Cora"}
    ).json()["id"]

    listing = db_client.get(f"/api/campaigns/{campaign_id}/characters")
    assert len(listing.json()) == 1

    assert db_client.delete(f"/api/characters/{character_id}").status_code == 204
    assert db_client.get(f"/api/characters/{character_id}").status_code == 404
