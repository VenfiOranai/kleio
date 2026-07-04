"""Integration tests for the entities + entity-groups CRUD and the save-time mention backfill."""

from fastapi.testclient import TestClient


def _create_entity(client: TestClient, campaign_id: int, name: str, **extra) -> dict:
    resp = client.post(f"/api/campaigns/{campaign_id}/entities", json={"name": name, **extra})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


# --- entity CRUD ------------------------------------------------------------


def test_create_and_list_entities(db_client: TestClient, campaign_id: int):
    _create_entity(db_client, campaign_id, "Gandalf")
    _create_entity(db_client, campaign_id, "Aragorn")

    names = [e["name"] for e in db_client.get(f"/api/campaigns/{campaign_id}/entities").json()]
    assert names == ["Aragorn", "Gandalf"]  # ordered case-insensitively by name


def test_create_is_idempotent_case_insensitive(db_client: TestClient, campaign_id: int):
    first = db_client.post(f"/api/campaigns/{campaign_id}/entities", json={"name": "Balrog"})
    assert first.status_code == 201, first.text

    again = db_client.post(f"/api/campaigns/{campaign_id}/entities", json={"name": "balrog"})
    assert again.status_code == 200  # existing row returned, not created
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["name"] == "Balrog"  # original casing preserved

    entities = db_client.get(f"/api/campaigns/{campaign_id}/entities").json()
    assert len(entities) == 1


def test_create_rejects_bracket_names(db_client: TestClient, campaign_id: int):
    resp = db_client.post(f"/api/campaigns/{campaign_id}/entities", json={"name": "Bad[Name]"})
    assert resp.status_code == 400


def test_rename_entity_and_conflict(db_client: TestClient, campaign_id: int):
    gandalf = _create_entity(db_client, campaign_id, "Gandalf")
    _create_entity(db_client, campaign_id, "Saruman")

    ok = db_client.put(f"/api/entities/{gandalf['id']}", json={"name": "Mithrandir"})
    assert ok.status_code == 200
    assert ok.json()["name"] == "Mithrandir"

    # Renaming onto another entity's name (case-insensitive) conflicts.
    clash = db_client.put(f"/api/entities/{gandalf['id']}", json={"name": "saruman"})
    assert clash.status_code == 409


def test_delete_entity(db_client: TestClient, campaign_id: int):
    entity = _create_entity(db_client, campaign_id, "Temporary")
    assert db_client.delete(f"/api/entities/{entity['id']}").status_code == 204
    assert db_client.get(f"/api/entities/{entity['id']}").status_code == 404


# --- groups -----------------------------------------------------------------


def _create_group(client: TestClient, campaign_id: int, name: str) -> dict:
    resp = client.post(f"/api/campaigns/{campaign_id}/entity-groups", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_group_crud_and_duplicate(db_client: TestClient, campaign_id: int):
    _create_group(db_client, campaign_id, "Allies")
    dup = db_client.post(f"/api/campaigns/{campaign_id}/entity-groups", json={"name": "Allies"})
    assert dup.status_code == 409

    groups = db_client.get(f"/api/campaigns/{campaign_id}/entity-groups").json()
    assert [g["name"] for g in groups] == ["Allies"]


def test_assign_group_and_reject_foreign_group(db_client: TestClient, campaign_id: int):
    group = _create_group(db_client, campaign_id, "Player Characters")
    entity = _create_entity(db_client, campaign_id, "Frodo")

    assigned = db_client.put(f"/api/entities/{entity['id']}", json={"group_id": group["id"]})
    assert assigned.status_code == 200
    assert assigned.json()["group_id"] == group["id"]

    # A group from another campaign can't be assigned.
    other_campaign = db_client.post("/api/campaigns", json={"name": "Other"}).json()["id"]
    other_group = _create_group(db_client, other_campaign, "Villains")
    bad = db_client.put(f"/api/entities/{entity['id']}", json={"group_id": other_group["id"]})
    assert bad.status_code == 400


def test_deleting_group_ungroups_its_entities(db_client: TestClient, campaign_id: int):
    group = _create_group(db_client, campaign_id, "Places")
    entity = _create_entity(db_client, campaign_id, "Rivendell", group_id=group["id"])
    assert entity["group_id"] == group["id"]

    assert db_client.delete(f"/api/entity-groups/{group['id']}").status_code == 204

    after = db_client.get(f"/api/entities/{entity['id']}").json()
    assert after["group_id"] is None  # ungrouped, not deleted


# --- save-time backfill -----------------------------------------------------


def _entity_names(client: TestClient, campaign_id: int) -> set[str]:
    return {e["name"] for e in client.get(f"/api/campaigns/{campaign_id}/entities").json()}


def test_session_save_backfills_mentions(db_client: TestClient, campaign_id: int):
    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/sessions",
        json={"title": "S1", "raw_notes": "@[Gandalf] fought the @[Balrog]."},
    )
    assert resp.status_code == 201, resp.text
    session_id = resp.json()["id"]
    assert _entity_names(db_client, campaign_id) == {"Gandalf", "Balrog"}

    # Editing notes with a new mention adds it…
    db_client.put(
        f"/api/sessions/{session_id}",
        json={"raw_notes": "@[Gandalf] and @[Aragorn] pressed on."},
    )
    assert _entity_names(db_client, campaign_id) == {"Gandalf", "Balrog", "Aragorn"}
    # …but removing a mention never deletes the (possibly curated) entity.
    assert "Balrog" in _entity_names(db_client, campaign_id)


def test_backfill_does_not_duplicate_existing(db_client: TestClient, campaign_id: int):
    group = _create_group(db_client, campaign_id, "Villains")
    db_client.put(
        f"/api/entities/{_create_entity(db_client, campaign_id, 'Balrog')['id']}",
        json={"group_id": group["id"]},
    )
    db_client.post(
        f"/api/campaigns/{campaign_id}/sessions",
        json={"title": "S", "raw_notes": "the @[balrog] returns"},
    )
    entities = db_client.get(f"/api/campaigns/{campaign_id}/entities").json()
    balrogs = [e for e in entities if e["name"].lower() == "balrog"]
    assert len(balrogs) == 1  # matched the existing one case-insensitively
    assert balrogs[0]["group_id"] == group["id"]  # curation preserved


def test_entities_require_auth(client: TestClient):
    assert client.get("/api/campaigns/1/entities").status_code == 401
