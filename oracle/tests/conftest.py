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

import pytest  # noqa: E402  (import after env is set, matching module intent)
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


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
