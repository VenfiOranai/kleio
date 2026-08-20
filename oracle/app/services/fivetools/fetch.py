"""Optional one-shot download of a 5etools dataset.

5etools has **no API** — this walks its static JSON paths (`spells/index.json`, then the
per-source spell files, plus the item/feat files) and saves them locally, so the reference
browser has something to index without the files being placed by hand.

Deliberately **not** part of startup: it hits a third party over undocumented paths that can
reorganize without notice, and tens of MB per boot (failing silently when the host is down)
would be worse than a one-off action you trigger and watch. It runs as a background job with
progress, kicked off by `POST /api/reference/fetch`.

Nothing here is bundled with Kleio: the content is WotC-copyrighted, and this only automates
the download you would otherwise do by hand, for personal single-user use.
"""

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Files the reference index reads, beyond the per-source spell files discovered at runtime.
CORE_FILES = (
    "items.json",
    "items-base.json",
    "magicvariants.json",
    "feats.json",
    "optionalfeatures.json",
)
SPELL_INDEX = "spells/index.json"
# Present in newer datasets only (the spell→class mapping moved out of the spell files).
OPTIONAL_FILES = ("spells/sources.json",)

# Without these there is nothing worth indexing, so the job fails rather than half-succeeding.
REQUIRED_FILES = (SPELL_INDEX, "items.json", "items-base.json")

_USER_AGENT = "kleio/0.1 (personal D&D campaign chronicle; single-user reference import)"
_TIMEOUT = 60


class FetchError(RuntimeError):
    """A download failed in a way that leaves the dataset unusable."""


def spell_files(index_json: dict[str, Any]) -> list[str]:
    """The per-source spell files listed by `spells/index.json` (pure)."""
    return [f"spells/{name}" for _, name in sorted(index_json.items()) if isinstance(name, str)]


def plan(index_json: dict[str, Any]) -> list[str]:
    """Every path to download, given an already-fetched spells index (pure)."""
    return [SPELL_INDEX, *spell_files(index_json), *OPTIONAL_FILES, *CORE_FILES]


def download_json(url: str) -> dict[str, Any]:
    """GET one JSON document. Kept tiny and injectable so tests never touch the network."""
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:  # noqa: S310 — fixed https base
        payload = response.read()
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        # A site that 200s an HTML shell for unknown paths would otherwise poison the dataset.
        raise FetchError(f"{url} did not return JSON") from exc
    if not isinstance(parsed, dict):
        raise FetchError(f"{url} returned unexpected JSON")
    return parsed


Getter = Callable[[str], dict[str, Any]]


@dataclass
class FetchStatus:
    """Progress for the UI. One job at a time, so this doubles as the job's state."""

    state: str = "idle"  # idle | running | done | error
    downloaded: int = 0
    total: int = 0
    current: str = ""
    message: str = ""
    dest: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "downloaded": self.downloaded,
            "total": self.total,
            "current": self.current,
            "message": self.message,
            "dest": self.dest,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


def fetch_dataset(
    dest: Path,
    base_url: str,
    get: Getter = download_json,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> int:
    """Download the dataset into ``dest``. Returns how many files were saved.

    Optional files that 404 are skipped; a missing *required* file raises ``FetchError`` so a
    half-downloaded directory is never reported as success.
    """
    base = base_url.rstrip("/")
    index = _get_or_fail(get, f"{base}/{SPELL_INDEX}", SPELL_INDEX)
    paths = plan(index)
    saved = 0
    _write(dest, SPELL_INDEX, index)
    saved += 1
    if on_progress:
        on_progress(saved, len(paths), SPELL_INDEX)

    for path in paths[1:]:
        if on_progress:
            on_progress(saved, len(paths), path)
        try:
            _write(dest, path, get(f"{base}/{path}"))
        except (FetchError, urllib.error.URLError, OSError) as exc:
            if path in REQUIRED_FILES:
                raise FetchError(f"Could not download {path}: {exc}") from exc
            continue  # optional/absent in this dataset version — keep going
        saved += 1
        if on_progress:
            on_progress(saved, len(paths), path)
    return saved


def _get_or_fail(get: Getter, url: str, path: str) -> dict[str, Any]:
    try:
        return get(url)
    except (FetchError, urllib.error.URLError, OSError) as exc:
        raise FetchError(f"Could not download {path}: {exc}") from exc


def _write(dest: Path, path: str, payload: dict[str, Any]) -> None:
    """Write one file, via a temp file so an interrupted run leaves no half-written JSON."""
    target = dest / path
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".part")
    temp.write_text(json.dumps(payload), encoding="utf-8")
    temp.replace(target)


@dataclass
class FetchJob:
    """The single background download, and its observable progress."""

    status: FetchStatus = field(default_factory=FetchStatus)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _thread: threading.Thread | None = None

    def running(self) -> bool:
        return self.status.state == "running"

    def start(
        self,
        dest: Path,
        base_url: str,
        get: Getter = download_json,
        on_success: Callable[[], None] | None = None,
    ) -> bool:
        """Kick off a download. Returns False when one is already in flight."""
        with self._lock:
            if self.running():
                return False
            self.status = FetchStatus(
                state="running",
                dest=str(dest),
                started_at=datetime.now(UTC),
                message="Starting…",
            )
        self._thread = threading.Thread(
            target=self._run,
            args=(dest, base_url, get, on_success),
            name="fivetools-fetch",
            daemon=True,
        )
        self._thread.start()
        return True

    def _run(
        self,
        dest: Path,
        base_url: str,
        get: Getter,
        on_success: Callable[[], None] | None,
    ) -> None:
        def progress(done: int, total: int, current: str) -> None:
            self.status.downloaded = done
            self.status.total = total
            self.status.current = current
            self.status.message = f"Downloading {current}…"

        try:
            saved = fetch_dataset(dest, base_url, get=get, on_progress=progress)
        except Exception as exc:  # noqa: BLE001 — any failure is reported, never raised into the thread
            self.status.state = "error"
            self.status.message = str(exc)
            self.status.finished_at = datetime.now(UTC)
            return

        if on_success:
            on_success()
        self.status.state = "done"
        self.status.current = ""
        self.status.message = f"Downloaded {saved} files."
        self.status.finished_at = datetime.now(UTC)


# One job per process; the router reads and starts it.
job = FetchJob()
