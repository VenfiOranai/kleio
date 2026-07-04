"""Integration tests for POST /api/campaigns/{id}/ask. The RAG service is mocked, so no
Gemini call is made — these check the HTTP contract and error mapping."""

from fastapi.testclient import TestClient

from app.services import ai, rag


def test_ask_returns_answer_with_citations(db_client: TestClient, campaign_id: int, monkeypatch):
    def _fake(db, cid, question):
        assert cid == campaign_id
        return rag.RagAnswer(
            answer="The lich rules the keep.",
            citations=[rag.Citation(session_id=42, title="The Keep", snippet="a lich...")],
        )

    monkeypatch.setattr(rag, "answer_campaign_question", _fake)

    resp = db_client.post(f"/api/campaigns/{campaign_id}/ask", json={"question": "Who rules?"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["question"] == "Who rules?"
    assert body["answer"] == "The lich rules the keep."
    assert body["citations"] == [
        {"session_id": 42, "title": "The Keep", "snippet": "a lich..."}
    ]


def test_ask_blank_question_is_400(db_client: TestClient, campaign_id: int, monkeypatch):
    called = False

    def _boom(db, cid, question):
        nonlocal called
        called = True
        return rag.RagAnswer(answer="x", citations=[])

    monkeypatch.setattr(rag, "answer_campaign_question", _boom)

    resp = db_client.post(f"/api/campaigns/{campaign_id}/ask", json={"question": "   "})
    assert resp.status_code == 400
    assert not called  # short-circuits before retrieval


def test_ask_missing_campaign_is_404(db_client: TestClient):
    resp = db_client.post("/api/campaigns/999999/ask", json={"question": "Who?"})
    assert resp.status_code == 404


def test_ask_not_configured_is_503(db_client: TestClient, campaign_id: int, monkeypatch):
    def _raise(db, cid, question):
        raise ai.AINotConfiguredError("Gemini is not configured (set GEMINI_API_KEY).")

    monkeypatch.setattr(rag, "answer_campaign_question", _raise)

    resp = db_client.post(f"/api/campaigns/{campaign_id}/ask", json={"question": "Who?"})
    assert resp.status_code == 503
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_ask_model_error_is_502(db_client: TestClient, campaign_id: int, monkeypatch):
    def _raise(db, cid, question):
        raise ai.AIError("Gemini request failed: boom")

    monkeypatch.setattr(rag, "answer_campaign_question", _raise)

    resp = db_client.post(f"/api/campaigns/{campaign_id}/ask", json={"question": "Who?"})
    assert resp.status_code == 502


def test_ask_requires_auth(client: TestClient):
    assert client.post("/api/campaigns/1/ask", json={"question": "Who?"}).status_code == 401
