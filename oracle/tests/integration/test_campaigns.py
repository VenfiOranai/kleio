from fastapi.testclient import TestClient


def test_create_and_get_campaign(db_client: TestClient):
    resp = db_client.post(
        "/api/campaigns", json={"name": "Curse of Strahd", "description": "gothic horror"}
    )
    assert resp.status_code == 201
    created = resp.json()
    assert created["name"] == "Curse of Strahd"

    got = db_client.get(f"/api/campaigns/{created['id']}")
    assert got.status_code == 200
    assert got.json()["description"] == "gothic horror"


def test_list_campaigns(db_client: TestClient):
    db_client.post("/api/campaigns", json={"name": "A"})
    db_client.post("/api/campaigns", json={"name": "B"})
    resp = db_client.get("/api/campaigns")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_update_campaign(db_client: TestClient, campaign_id: int):
    resp = db_client.put(f"/api/campaigns/{campaign_id}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


def test_delete_campaign(db_client: TestClient, campaign_id: int):
    assert db_client.delete(f"/api/campaigns/{campaign_id}").status_code == 204
    assert db_client.get(f"/api/campaigns/{campaign_id}").status_code == 404


def test_get_missing_campaign_404(db_client: TestClient):
    assert db_client.get("/api/campaigns/999999").status_code == 404


def test_campaigns_require_auth(client: TestClient):
    assert client.get("/api/campaigns").status_code == 401
