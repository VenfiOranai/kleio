"""Dev entrypoint: start the Oracle API with autoreload.

Usage (from oracle/, with the venv active or via its python):
    ./.venv/Scripts/python run.py     # Windows
    ./.venv/bin/python run.py         # macOS/Linux

Host/port default to 127.0.0.1:8000; override with ORACLE_HOST / ORACLE_PORT.
For the full stack (API + Postgres) use docker compose instead — see README.
"""

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host=os.getenv("ORACLE_HOST", "127.0.0.1"),
        port=int(os.getenv("ORACLE_PORT", "8000")),
    )


if __name__ == "__main__":
    main()
