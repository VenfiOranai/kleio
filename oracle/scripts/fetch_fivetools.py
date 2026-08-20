"""Download a 5etools dataset for the reference browser (Phase 13).

The campaigns page has a button that does this through the API; this is the same job for a
headless box (or a first run before the app is up).

Usage (from oracle/):
    ./.venv/Scripts/python scripts/fetch_fivetools.py [DEST]

DEST defaults to `fivetools_download_dir` (`oracle/var/fivetools`) — where the oracle looks
when FIVETOOLS_DATA_DIR is unset. Kleio bundles no game data; this only automates the
download you would otherwise do by hand, for personal single-user use.
"""

import sys
from pathlib import Path

from app.core.config import get_settings
from app.services.fivetools import fetch, index


def main() -> None:
    dest = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else index.download_dir()
    source = get_settings().fivetools_source_url
    print(f"Downloading 5etools data from {source}\n            into {dest}")

    def progress(done: int, total: int, current: str) -> None:
        print(f"  [{done:>3}/{total}] {current}", flush=True)

    try:
        saved = fetch.fetch_dataset(dest, source, on_progress=progress)
    except fetch.FetchError as exc:
        raise SystemExit(f"Download failed: {exc}") from exc

    print(f"\nSaved {saved} files to {dest}")
    if configured := index.configured_data_dir():
        print(
            f"Note: FIVETOOLS_DATA_DIR is set ({configured}), so the oracle will read that "
            "instead of what was just downloaded."
        )


if __name__ == "__main__":
    main()
