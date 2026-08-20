"""Integration tests for /api/reference — the 5etools browse/import endpoints.

DB-free (the index lives in memory), so these use the plain `client` + a bearer token. They
run against the miniature fixture dataset in `tests/fixtures/fivetools`.
"""

import pytest
from fastapi.testclient import TestClient


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- Availability ------------------------------------------------------------


def test_status_reports_unavailable_without_a_dataset(
    client: TestClient, auth_token: str, no_fivetools_data
):
    resp = client.get("/api/reference/status", headers=auth(auth_token))
    assert resp.status_code == 200
    assert resp.json() == {"available": False, "counts": {}, "configured_dir": ""}


def test_data_routes_are_503_without_a_dataset(
    client: TestClient, auth_token: str, no_fivetools_data
):
    for path in (
        "/api/reference/search?type=spell",
        "/api/reference/facets?type=spell",
        "/api/reference/spell/spell-fireball-phb",
    ):
        resp = client.get(path, headers=auth(auth_token))
        assert resp.status_code == 503, path
        assert "FIVETOOLS_DATA_DIR" in resp.json()["detail"]


def test_status_reports_counts_when_configured(
    client: TestClient, auth_token: str, fivetools_data
):
    body = client.get("/api/reference/status", headers=auth(auth_token)).json()
    assert body["available"] is True
    assert body["counts"] == {"spell": 3, "item": 13, "feature": 4}


def test_reference_requires_auth(client: TestClient, fivetools_data):
    assert client.get("/api/reference/status").status_code == 401
    assert client.get("/api/reference/search?type=spell").status_code == 401
    assert client.post("/api/reference/fetch").status_code == 401


def test_status_reports_a_configured_dir(client: TestClient, auth_token: str, fivetools_data):
    body = client.get("/api/reference/status", headers=auth(auth_token)).json()
    assert body["configured_dir"].endswith("fivetools")


# --- Dataset download --------------------------------------------------------


def test_fetch_is_idle_until_started(client: TestClient, auth_token: str, no_fivetools_data):
    body = client.get("/api/reference/fetch", headers=auth(auth_token)).json()
    assert body["state"] in ("idle", "done", "error")  # a previous test may have run one


def test_fetch_starts_a_background_download(
    client: TestClient, auth_token: str, no_fivetools_data, monkeypatch, tmp_path
):
    """The job itself is unit-tested; here we only check the endpoint's contract (no network)."""
    from app.core.config import get_settings
    from app.services import fivetools

    started: dict[str, object] = {}

    def fake_start(dest, base_url, **kwargs):
        started["dest"] = str(dest)
        started["base_url"] = base_url
        fivetools.job.status = fivetools.FetchStatus(state="running", dest=str(dest), total=9)
        return True

    monkeypatch.setattr(fivetools.job, "start", fake_start)
    monkeypatch.setattr(get_settings(), "fivetools_download_dir", str(tmp_path))

    resp = client.post("/api/reference/fetch", headers=auth(auth_token))
    assert resp.status_code == 202, resp.text
    assert resp.json()["state"] == "running"
    assert started["dest"] == str(tmp_path)
    assert started["base_url"].startswith("http")

    # The status endpoint reports the same job.
    assert client.get("/api/reference/fetch", headers=auth(auth_token)).json()["total"] == 9
    fivetools.job.status = fivetools.FetchStatus()


def test_fetch_refuses_while_one_is_running(
    client: TestClient, auth_token: str, no_fivetools_data, monkeypatch
):
    from app.services import fivetools

    monkeypatch.setattr(fivetools.job, "start", lambda *a, **k: False)
    resp = client.post("/api/reference/fetch", headers=auth(auth_token))
    assert resp.status_code == 409
    assert "already running" in resp.json()["detail"]


def test_fetch_refuses_when_your_own_copy_is_configured(
    client: TestClient, auth_token: str, fivetools_data, monkeypatch
):
    """Downloading would write files the index would never read — say so instead."""
    from app.services import fivetools

    monkeypatch.setattr(
        fivetools.job, "start", lambda *a, **k: pytest.fail("should not start a download")
    )
    resp = client.post("/api/reference/fetch", headers=auth(auth_token))
    assert resp.status_code == 409
    assert "FIVETOOLS_DATA_DIR" in resp.json()["detail"]


# --- Search ------------------------------------------------------------------


def test_search_returns_summaries_with_facets(
    client: TestClient, auth_token: str, fivetools_data
):
    resp = client.get("/api/reference/search?type=spell&q=fire", headers=auth(auth_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    first = body["results"][0]
    assert first["name"] == "Fire Bolt"
    assert first["id"] == "spell-fire-bolt-phb"
    assert first["level"] == 0
    assert first["school"] == "Evocation"
    assert first["classes"] == ["Sorcerer", "Wizard"]
    assert first["subtitle"] == "Cantrip Evocation · Sorcerer, Wizard"


def test_search_filters_and_sorts(client: TestClient, auth_token: str, fivetools_data):
    url = "/api/reference/search?type=spell&level=0&level=3&sort=level&direction=desc"
    names = [r["name"] for r in client.get(url, headers=auth(auth_token)).json()["results"]]
    assert names == ["Fireball", "Fire Bolt"]


def test_class_filter_uses_the_reserved_query_name(
    client: TestClient, auth_token: str, fivetools_data
):
    resp = client.get("/api/reference/search?type=spell&class=Cleric", headers=auth(auth_token))
    assert [r["name"] for r in resp.json()["results"]] == ["Detect Magic"]


def test_weapons_only_narrows_the_item_list(client: TestClient, auth_token: str, fivetools_data):
    resp = client.get("/api/reference/search?type=item&weapons_only=true", headers=auth(auth_token))
    names = [r["name"] for r in resp.json()["results"]]
    assert "Longsword" in names
    assert "Potion of Healing" not in names
    assert all(r["weapon"] for r in resp.json()["results"])


def test_paging_reports_the_full_total(client: TestClient, auth_token: str, fivetools_data):
    body = client.get("/api/reference/search?type=item&limit=2", headers=auth(auth_token)).json()
    assert body["total"] == 13
    assert len(body["results"]) == 2


def test_unknown_sort_is_rejected(client: TestClient, auth_token: str, fivetools_data):
    resp = client.get("/api/reference/search?type=spell&sort=rarity", headers=auth(auth_token))
    assert resp.status_code == 400
    assert "Unsupported sort" in resp.json()["detail"]


def test_unknown_type_is_rejected(client: TestClient, auth_token: str, fivetools_data):
    assert client.get(
        "/api/reference/search?type=monster", headers=auth(auth_token)
    ).status_code == 422


# --- Facets ------------------------------------------------------------------


def test_facets_describe_the_available_filters(
    client: TestClient, auth_token: str, fivetools_data
):
    body = client.get("/api/reference/facets?type=item", headers=auth(auth_token)).json()
    assert body["type"] == "item"
    assert body["categories"] == ["Armor", "Consumables", "Gear", "Weapons"]
    assert body["rarities"] == ["none", "common", "uncommon", "very rare"]
    assert "value" in body["sorts"]
    # Spell-only facets stay empty for items.
    assert body["schools"] == [] and body["levels"] == []


# --- Records -----------------------------------------------------------------


def test_full_spell_record_imports_into_the_sheets_schema(
    client: TestClient, auth_token: str, fivetools_data
):
    resp = client.get("/api/reference/spell/spell-fireball-phb", headers=auth(auth_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["item"] is None and body["feature"] is None
    spell = body["spell"]
    assert spell["name"] == "Fireball"
    assert spell["level"] == 3
    assert spell["components"] == "V, S, M (a tiny ball of bat guano and sulfur)"
    assert "{@" not in spell["description"]
    assert spell["at_higher_levels"].startswith("When you cast this spell")
    # Imported spells arrive unprepared — the player decides.
    assert spell["prepared"] is False


def test_full_weapon_record_carries_an_attack(client: TestClient, auth_token: str, fivetools_data):
    resp = client.get("/api/reference/item/item-1-longsword-dmg", headers=auth(auth_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["item"]["name"] == "+1 Longsword"
    assert body["item"]["quantity"] == 1
    assert body["attack"]["damage_dice"] == "1d8"
    assert body["attack"]["damage_type"] == "slashing"
    assert body["attack"]["bonus"] == 1


def test_full_feature_record(client: TestClient, auth_token: str, fivetools_data):
    body = client.get(
        "/api/reference/feature/feature-grappler-phb", headers=auth(auth_token)
    ).json()
    assert body["feature"]["source"] == "feat"
    assert body["feature"]["uses"] is None
    assert "Prerequisite: Strength 13" in body["feature"]["description"]


def test_unknown_record_is_404(client: TestClient, auth_token: str, fivetools_data):
    assert client.get(
        "/api/reference/spell/spell-nope", headers=auth(auth_token)
    ).status_code == 404


def test_record_type_must_match_the_id(client: TestClient, auth_token: str, fivetools_data):
    assert client.get(
        "/api/reference/item/spell-fireball-phb", headers=auth(auth_token)
    ).status_code == 404
