# Oracle — Kleio backend (FastAPI)

The service that "holds the answers": REST API over PostgreSQL, plus (later) the Gemini
AI features. See `../docs/architecture.md` §3.

## Local dev (without Docker)

```bash
cd oracle
py -3.12 -m venv .venv
# Windows:
./.venv/Scripts/python -m pip install -e ".[dev]"
./.venv/Scripts/python run.py
# macOS/Linux: source .venv/bin/activate && pip install -e ".[dev]" && python run.py
```

Health check: <http://localhost:8000/api/health> → `{"status": "ok"}`

## Tests & lint

```bash
./.venv/Scripts/python -m pytest        # unit + integration
./.venv/Scripts/python -m ruff check .  # lint
```

## Full stack (API + Postgres) via Docker

```bash
docker compose -f ../infra/docker-compose.yml up
```

## Layout

```
app/
  main.py            # app factory + router registration
  core/              # config (pydantic-settings), db (SQLAlchemy engine/session)
  api/
    deps.py          # shared dependencies (get_db, later get_current_user)
    routers/         # health (+ campaigns/sessions/characters/auth in Phase 1)
  models/            # SQLAlchemy models (Phase 1)
  schemas/           # Pydantic schemas (Phase 1)
  services/          # character_calc, search, ai (later phases)
tests/
  unit/              # pure logic, no DB
  integration/       # API via TestClient
```
