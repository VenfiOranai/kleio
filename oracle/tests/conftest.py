"""Test configuration: set auth env vars BEFORE the app imports settings.

Runs at conftest import time (before any test module imports `app.main`), so the
single-user credentials and JWT secret are in place when settings are first read.
"""

import os

from app.core.security import hash_password

TEST_USERNAME = "tester"
TEST_PASSWORD = "s3cret-pass"

os.environ["APP_USERNAME"] = TEST_USERNAME
os.environ["APP_PASSWORD_HASH"] = hash_password(TEST_PASSWORD)
os.environ["JWT_SECRET"] = "test-secret-key-not-for-production"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402, F401  — register models on Base.metadata
from app.api.deps import get_current_user  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

# --- Auth / no-DB fixtures ---------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def credentials() -> dict[str, str]:
    return {"username": TEST_USERNAME, "password": TEST_PASSWORD}


@pytest.fixture
def auth_token(client: TestClient, credentials: dict[str, str]) -> str:
    resp = client.post("/api/auth/login", json=credentials)
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


# --- DB-backed fixtures (require Postgres) -----------------------------------


@pytest.fixture(scope="session")
def engine():
    # Short connect timeout so the suite fails fast (and skips) when Postgres is down.
    eng = create_engine(get_settings().database_url, connect_args={"connect_timeout": 3})
    try:
        # Tests build the schema via create_all (not Alembic), so enable pgvector here the way
        # the migration does — otherwise the note_embeddings VECTOR column can't be created.
        with eng.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # Idempotent (checkfirst); no drop_all — each test rolls back its own transaction,
        # so the suite is non-destructive even when run against a dev database.
        Base.metadata.create_all(eng)
    except OperationalError:
        pytest.skip(
            "Postgres not available; run: docker compose -f infra/docker-compose.yml up -d db"
        )
    yield eng
    eng.dispose()


@pytest.fixture
def db_session(engine):
    """A session wrapped in a transaction that is rolled back after each test.

    ``join_transaction_mode="create_savepoint"`` lets endpoint commits use savepoints
    so the outer transaction rollback still undoes everything.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def db_client(db_session: Session) -> TestClient:
    """TestClient with the DB bound to the rolled-back test session and auth bypassed."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: TEST_USERNAME
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def campaign_id(db_client: TestClient) -> int:
    resp = db_client.post("/api/campaigns", json={"name": "Test Campaign"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]
