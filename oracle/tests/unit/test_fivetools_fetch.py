"""Unit tests for the optional 5etools download. The getter is injected, so nothing here
touches the network."""

import json
import urllib.error

import pytest

from app.services.fivetools import fetch

INDEX = {"PHB": "spells-phb.json", "XGE": "spells-xge.json"}


def fake_site(overrides: dict[str, object] | None = None):
    """A stand-in 5etools host: every known path returns a small JSON document."""
    pages: dict[str, object] = {
        "spells/index.json": INDEX,
        "spells/spells-phb.json": {"spell": [{"name": "Fireball"}]},
        "spells/spells-xge.json": {"spell": [{"name": "Toll the Dead"}]},
        "spells/sources.json": {"PHB": {}},
        "items.json": {"item": []},
        "items-base.json": {"baseitem": []},
        "magicvariants.json": {"magicvariant": []},
        "feats.json": {"feat": []},
        "optionalfeatures.json": {"optionalfeature": []},
        **(overrides or {}),
    }

    def get(url: str) -> dict:
        path = url.split("/data/", 1)[1]
        page = pages.get(path)
        if page is None:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)  # type: ignore[arg-type]
        if isinstance(page, Exception):
            raise page
        return page

    return get


def test_plan_covers_the_spell_files_named_by_the_index():
    paths = fetch.plan(INDEX)
    assert paths[0] == "spells/index.json"
    assert "spells/spells-phb.json" in paths
    assert "spells/spells-xge.json" in paths
    assert set(fetch.CORE_FILES) <= set(paths)


def test_downloads_everything_into_the_destination(tmp_path):
    saved = fetch.fetch_dataset(tmp_path, "https://example.test/data", get=fake_site())

    assert saved == 9
    assert json.loads((tmp_path / "items.json").read_text())["item"] == []
    assert json.loads((tmp_path / "spells" / "spells-phb.json").read_text())["spell"][0][
        "name"
    ] == "Fireball"
    # Nothing half-written is left behind.
    assert not list(tmp_path.rglob("*.part"))


def test_reports_progress_as_it_goes(tmp_path):
    seen: list[tuple[int, int, str]] = []
    fetch.fetch_dataset(
        tmp_path,
        "https://example.test/data",
        get=fake_site(),
        on_progress=lambda done, total, current: seen.append((done, total, current)),
    )
    assert seen[0] == (1, 9, "spells/index.json")
    assert seen[-1][0] == 9 and seen[-1][1] == 9


def test_optional_files_missing_from_an_older_dataset_are_skipped(tmp_path):
    site = fake_site()

    def without_sources(url: str) -> dict:
        if url.endswith("spells/sources.json"):
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)  # type: ignore[arg-type]
        return site(url)

    saved = fetch.fetch_dataset(tmp_path, "https://example.test/data", get=without_sources)
    assert saved == 8
    assert not (tmp_path / "spells" / "sources.json").exists()


def test_a_missing_required_file_fails_the_whole_download(tmp_path):
    site = fake_site()

    def without_items(url: str) -> dict:
        if url.endswith("/items.json"):
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)  # type: ignore[arg-type]
        return site(url)

    with pytest.raises(fetch.FetchError, match="items.json"):
        fetch.fetch_dataset(tmp_path, "https://example.test/data", get=without_items)


def test_an_unreachable_index_fails_immediately(tmp_path):
    def offline(url: str) -> dict:
        raise urllib.error.URLError("host is down")

    with pytest.raises(fetch.FetchError, match="spells/index.json"):
        fetch.fetch_dataset(tmp_path, "https://example.test/data", get=offline)
    assert not list(tmp_path.iterdir())


def test_html_masquerading_as_json_is_rejected(tmp_path, monkeypatch):
    """A site that 200s an HTML shell for unknown paths must not poison the dataset."""

    class FakeResponse:
        def read(self) -> bytes:
            return b"<!doctype html><title>5etools</title>"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(fetch.urllib.request, "urlopen", lambda *a, **k: FakeResponse())
    with pytest.raises(fetch.FetchError, match="did not return JSON"):
        fetch.download_json("https://example.test/data/items.json")


# --- The background job ------------------------------------------------------


def test_job_runs_to_completion_and_refreshes_the_index(tmp_path):
    job = fetch.FetchJob()
    refreshed: list[bool] = []

    assert job.start(
        tmp_path,
        "https://example.test/data",
        get=fake_site(),
        on_success=lambda: refreshed.append(True),
    )
    job._thread.join(timeout=10)

    assert job.status.state == "done"
    assert job.status.downloaded == 9
    assert "9 files" in job.status.message
    assert job.status.finished_at is not None
    assert refreshed == [True]  # the load-once index was invalidated


def test_job_records_a_failure_instead_of_raising(tmp_path):
    job = fetch.FetchJob()

    def offline(url: str) -> dict:
        raise urllib.error.URLError("host is down")

    job.start(tmp_path, "https://example.test/data", get=offline)
    job._thread.join(timeout=10)

    assert job.status.state == "error"
    assert "host is down" in job.status.message


def test_only_one_download_runs_at_a_time(tmp_path):
    job = fetch.FetchJob()
    job.status = fetch.FetchStatus(state="running")
    assert job.start(tmp_path, "https://example.test/data", get=fake_site()) is False
