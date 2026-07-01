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


def test_list_and_delete_character(db_client: TestClient, campaign_id: int):
    character_id = db_client.post(
        f"/api/campaigns/{campaign_id}/characters", json={"name": "Cora"}
    ).json()["id"]

    listing = db_client.get(f"/api/campaigns/{campaign_id}/characters")
    assert len(listing.json()) == 1

    assert db_client.delete(f"/api/characters/{character_id}").status_code == 204
    assert db_client.get(f"/api/characters/{character_id}").status_code == 404
