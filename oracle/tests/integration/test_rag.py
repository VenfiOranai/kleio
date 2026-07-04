"""End-to-end RAG tests against real Postgres + pgvector. Only the Gemini calls are faked:
a deterministic keyword embedder makes cosine retrieval meaningful without a network call."""

from fastapi.testclient import TestClient

from app.services import ai

# Each keyword owns a dimension; a trailing baseline dim keeps every vector non-zero (cosine
# distance is undefined for the zero vector).
_KEYWORDS = ["dragon", "tavern", "wizard"]


def _fake_embed(texts, *, task_type="RETRIEVAL_DOCUMENT"):
    vectors = []
    for text in texts:
        low = text.lower()
        vec = [0.0] * ai.EMBED_DIM
        vec[-1] = 1.0
        for i, kw in enumerate(_KEYWORDS):
            if kw in low:
                vec[i] = 1.0
        vectors.append(vec)
    return vectors


def _patch_ai(monkeypatch):
    monkeypatch.setattr(ai, "embed_texts", _fake_embed)
    monkeypatch.setattr(
        ai, "answer_question", lambda q, contexts: f"Answer using {len(contexts)} excerpts."
    )


def _make_session(client: TestClient, campaign_id: int, title: str, notes: str) -> int:
    resp = client.post(
        f"/api/campaigns/{campaign_id}/sessions", json={"title": title, "raw_notes": notes}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_ask_cites_the_relevant_session(db_client: TestClient, campaign_id: int, monkeypatch):
    _patch_ai(monkeypatch)
    dragon = _make_session(db_client, campaign_id, "The Dragon's Lair", "A red dragon guards gold.")
    _make_session(db_client, campaign_id, "The Tavern", "A brawl broke out in the tavern.")

    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/ask", json={"question": "What about the dragon?"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["answer"] == "Answer using 2 excerpts."
    # The dragon session is the closest match, so it's the top citation.
    assert body["citations"][0]["session_id"] == dragon
    assert body["citations"][0]["title"] == "The Dragon's Lair"


def test_ask_indexes_preexisting_notes_on_demand(
    db_client: TestClient, campaign_id: int, monkeypatch
):
    # Session created while AI is unconfigured → save succeeds but nothing is embedded.
    session_id = _make_session(db_client, campaign_id, "Old Notes", "A wizard cast a spell.")

    # Now AI is available: the first ask should back-fill the missing embedding, then answer.
    _patch_ai(monkeypatch)
    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/ask", json={"question": "Tell me about the wizard."}
    )
    assert resp.status_code == 200, resp.text
    citations = resp.json()["citations"]
    assert citations and citations[0]["session_id"] == session_id


def test_ask_with_no_notes_returns_empty_citations(
    db_client: TestClient, campaign_id: int, monkeypatch
):
    _patch_ai(monkeypatch)
    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/ask", json={"question": "Anything happen?"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["citations"] == []
    # answer_question is never called when there's nothing to cite.
    assert "couldn't find" in body["answer"].lower()


def test_notes_reembedded_when_edited(db_client: TestClient, campaign_id: int, monkeypatch):
    _patch_ai(monkeypatch)
    session_id = _make_session(db_client, campaign_id, "Shifting Tale", "A dragon appears.")

    # Rewrite the notes to be about the tavern instead; the dragon query should no longer cite it.
    db_client.put(f"/api/sessions/{session_id}", json={"raw_notes": "A quiet night at the tavern."})

    resp = db_client.post(
        f"/api/campaigns/{campaign_id}/ask", json={"question": "Where is the tavern?"}
    )
    assert resp.status_code == 200, resp.text
    snippet = resp.json()["citations"][0]["snippet"].lower()
    assert "tavern" in snippet and "dragon" not in snippet
