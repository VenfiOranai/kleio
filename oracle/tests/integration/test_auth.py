from fastapi.testclient import TestClient


def test_login_success_returns_token(client: TestClient, credentials: dict[str, str]):
    resp = client.post("/api/auth/login", json=credentials)
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


def test_login_wrong_password_401(client: TestClient, credentials: dict[str, str]):
    resp = client.post("/api/auth/login", json={**credentials, "password": "nope"})
    assert resp.status_code == 401


def test_login_wrong_username_401(client: TestClient, credentials: dict[str, str]):
    resp = client.post("/api/auth/login", json={**credentials, "username": "someoneelse"})
    assert resp.status_code == 401


def test_me_requires_auth(client: TestClient):
    assert client.get("/api/auth/me").status_code == 401


def test_me_rejects_bad_token(client: TestClient):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_me_returns_user(client: TestClient, auth_token: str, credentials: dict[str, str]):
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {auth_token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == credentials["username"]
