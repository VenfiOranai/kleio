from fastapi.testclient import TestClient


def test_create_and_get_session(db_client: TestClient, campaign_id: int):
    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/sessions",
        json={"title": "Session 1", "raw_notes": "# Notes\nThe party met."},
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    got = db_client.get(f"/api/sessions/{session_id}")
    assert got.status_code == 200
    assert got.json()["raw_notes"] == "# Notes\nThe party met."
    assert got.json()["summary"] is None


def test_list_sessions_for_campaign(db_client: TestClient, campaign_id: int):
    db_client.post(f"/api/campaigns/{campaign_id}/sessions", json={"title": "S1"})
    db_client.post(f"/api/campaigns/{campaign_id}/sessions", json={"title": "S2"})
    resp = db_client.get(f"/api/campaigns/{campaign_id}/sessions")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_update_session_preserves_raw_notes(db_client: TestClient, campaign_id: int):
    session_id = db_client.post(
        f"/api/campaigns/{campaign_id}/sessions",
        json={"title": "S1", "raw_notes": "original text"},
    ).json()["id"]

    resp = db_client.put(f"/api/sessions/{session_id}", json={"summary": "a tidy summary"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"] == "a tidy summary"
    assert body["raw_notes"] == "original text"  # raw notes always preserved


def test_delete_session(db_client: TestClient, campaign_id: int):
    session_id = db_client.post(
        f"/api/campaigns/{campaign_id}/sessions", json={"title": "S1"}
    ).json()["id"]
    assert db_client.delete(f"/api/sessions/{session_id}").status_code == 204
    assert db_client.get(f"/api/sessions/{session_id}").status_code == 404


def test_session_under_missing_campaign_404(db_client: TestClient):
    resp = db_client.post("/api/campaigns/999999/sessions", json={"title": "x"})
    assert resp.status_code == 404
