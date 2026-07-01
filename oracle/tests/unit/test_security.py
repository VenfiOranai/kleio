import jwt
import pytest

from app.core.security import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_roundtrip():
    hashed = hash_password("hunter2")
    assert hashed != "hunter2"
    assert verify_password("hunter2", hashed)
    assert not verify_password("wrong", hashed)


def test_verify_empty_hash_is_false():
    assert not verify_password("anything", "")


def test_token_roundtrip():
    token = create_access_token("alice")
    assert decode_token(token)["sub"] == "alice"


def test_decode_invalid_token_raises():
    with pytest.raises(jwt.PyJWTError):
        decode_token("not-a-real-token")
