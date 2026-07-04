"""Integration tests for POST /api/sessions/{id}/summarize. The AI service is mocked,
so no Gemini call is made."""

from fastapi.testclient import TestClient

from app.services import ai


def _make_session(client: TestClient, campaign_id: int, raw_notes: str) -> int:
    resp = client.post(
        f"/api/campaigns/{campaign_id}/sessions",
        json={"title": "Session", "raw_notes": raw_notes},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_summarize_stores_summary_and_preserves_raw_notes(
    db_client: TestClient, campaign_id: int, monkeypatch
):
    monkeypatch.setattr(ai, "summarize_session", lambda notes: "## Recap\n- We won.")
    session_id = _make_session(db_client, campaign_id, "The party fought a dragon.")

    resp = db_client.post(f"/api/sessions/{session_id}/summarize")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"] == "## Recap\n- We won."
    assert body["raw_notes"] == "The party fought a dragon."  # never mutated

    # Persisted, not just returned.
    assert db_client.get(f"/api/sessions/{session_id}").json()["summary"] == "## Recap\n- We won."


def test_summarize_empty_notes_is_400(db_client: TestClient, campaign_id: int, monkeypatch):
    called = False

    def _boom(notes):
        nonlocal called
        called = True
        return "should not be called"

    monkeypatch.setattr(ai, "summarize_session", _boom)
    session_id = _make_session(db_client, campaign_id, "   ")

    resp = db_client.post(f"/api/sessions/{session_id}/summarize")
    assert resp.status_code == 400
    assert not called  # short-circuits before hitting the model


def test_summarize_not_configured_is_503(db_client: TestClient, campaign_id: int, monkeypatch):
    def _raise(notes):
        raise ai.AINotConfiguredError("Gemini is not configured (set GEMINI_API_KEY).")

    monkeypatch.setattr(ai, "summarize_session", _raise)
    session_id = _make_session(db_client, campaign_id, "some notes")

    resp = db_client.post(f"/api/sessions/{session_id}/summarize")
    assert resp.status_code == 503
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_summarize_model_error_is_502(db_client: TestClient, campaign_id: int, monkeypatch):
    def _raise(notes):
        raise ai.AIError("Gemini request failed: boom")

    monkeypatch.setattr(ai, "summarize_session", _raise)
    session_id = _make_session(db_client, campaign_id, "some notes")

    resp = db_client.post(f"/api/sessions/{session_id}/summarize")
    assert resp.status_code == 502


def test_summarize_missing_session_is_404(db_client: TestClient):
    assert db_client.post("/api/sessions/999999/summarize").status_code == 404


def test_summarize_requires_auth(client: TestClient):
    assert client.post("/api/sessions/1/summarize").status_code == 401
