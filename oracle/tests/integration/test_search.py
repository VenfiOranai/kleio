from fastapi.testclient import TestClient


def _make_session(client: TestClient, campaign_id: int, title: str, raw_notes: str = "") -> int:
    resp = client.post(
        f"/api/campaigns/{campaign_id}/sessions",
        json={"title": title, "raw_notes": raw_notes},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_search_matches_session_body(db_client: TestClient, campaign_id: int):
    _make_session(db_client, campaign_id, "Session One", "The party fought a goblin ambush.")

    # Scope to this campaign so the assertion is robust to any other data in the DB.
    resp = db_client.get("/api/search", params={"q": "goblin", "campaign_id": campaign_id})
    assert resp.status_code == 200
    body = resp.json()
    assert body["query"] == "goblin"

    hits = [r for r in body["results"] if r["type"] == "session"]
    assert len(hits) == 1
    hit = hits[0]
    assert hit["title"] == "Session One"
    assert hit["campaign_id"] == campaign_id
    assert "<mark>" in hit["snippet"]  # match is highlighted
    assert hit["rank"] > 0


def test_search_ranks_title_above_body(db_client: TestClient, campaign_id: int):
    # "dragon" appears in one session's body and another's title; the title is weighted higher.
    _make_session(db_client, campaign_id, "Tavern Night", "A quiet evening; a dragon is mentioned.")
    _make_session(db_client, campaign_id, "Dragon Assault", "The keep burns.")

    resp = db_client.get("/api/search", params={"q": "dragon", "campaign_id": campaign_id})
    hits = [r for r in resp.json()["results"] if r["type"] == "session"]
    assert len(hits) == 2
    assert hits[0]["title"] == "Dragon Assault"  # weight A (title) outranks weight C (body)


def test_search_matches_character_name(db_client: TestClient, campaign_id: int):
    db_client.post(f"/api/campaigns/{campaign_id}/characters", json={"name": "Gandalf the Grey"})

    resp = db_client.get("/api/search", params={"q": "gandalf", "campaign_id": campaign_id})
    char_hits = [r for r in resp.json()["results"] if r["type"] == "character"]
    assert len(char_hits) == 1
    assert char_hits[0]["title"] == "Gandalf the Grey"
    assert char_hits[0]["snippet"] is None  # characters aren't full-text/snippeted


def test_search_scoped_to_campaign(db_client: TestClient, campaign_id: int):
    other_id = db_client.post("/api/campaigns", json={"name": "Other Campaign"}).json()["id"]
    _make_session(db_client, campaign_id, "Alpha", "the frobnicate ritual")
    _make_session(db_client, other_id, "Beta", "another frobnicate ritual")

    unscoped = db_client.get("/api/search", params={"q": "frobnicate"}).json()["results"]
    assert {campaign_id, other_id}.issubset({r["campaign_id"] for r in unscoped})

    scoped = db_client.get(
        "/api/search", params={"q": "frobnicate", "campaign_id": campaign_id}
    ).json()["results"]
    assert len(scoped) == 1
    assert scoped[0]["campaign_id"] == campaign_id


def test_search_blank_query_returns_no_results(db_client: TestClient, campaign_id: int):
    _make_session(db_client, campaign_id, "Whatever", "some content")
    resp = db_client.get("/api/search", params={"q": "   "})
    assert resp.status_code == 200
    assert resp.json() == {"query": "", "results": []}


def test_search_no_match_is_empty(db_client: TestClient, campaign_id: int):
    _make_session(db_client, campaign_id, "Alpha", "ordinary notes")
    resp = db_client.get("/api/search", params={"q": "nonexistentterm12345"})
    assert resp.json()["results"] == []


def test_search_special_characters_dont_error(db_client: TestClient, campaign_id: int):
    # LIKE wildcards / tsquery punctuation must be handled, not crash.
    db_client.post(f"/api/campaigns/{campaign_id}/characters", json={"name": "100% Legit"})
    resp = db_client.get("/api/search", params={"q": "100%", "campaign_id": campaign_id})
    assert resp.status_code == 200
    char_hits = [r for r in resp.json()["results"] if r["type"] == "character"]
    assert any(h["title"] == "100% Legit" for h in char_hits)


def test_search_requires_auth(client: TestClient):
    assert client.get("/api/search", params={"q": "x"}).status_code == 401
