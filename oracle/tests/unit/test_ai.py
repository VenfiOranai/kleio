"""Unit tests for the Gemini summarization wrapper. The genai client is mocked, so
these never make a network call."""

import pytest

from app.services import ai


class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _FakeModels:
    def __init__(self, text=None, error=None):
        self._text = text
        self._error = error
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._error is not None:
            raise self._error
        return _FakeResponse(self._text)


class _FakeClient:
    def __init__(self, text=None, error=None):
        self.models = _FakeModels(text=text, error=error)


def _patch_client(monkeypatch, **kwargs):
    client = _FakeClient(**kwargs)
    monkeypatch.setattr(ai, "_client", lambda: client)
    return client


def test_summarize_returns_stripped_markdown(monkeypatch):
    client = _patch_client(monkeypatch, text="  ## Recap\n- The party won.  \n")
    result = ai.summarize_session("The party fought goblins and won.")
    assert result == "## Recap\n- The party won."
    # The raw notes are passed through as the model contents.
    assert client.models.calls[0]["contents"] == "The party fought goblins and won."


def test_summarize_empty_notes_raises(monkeypatch):
    _patch_client(monkeypatch, text="unused")
    with pytest.raises(ai.AIError):
        ai.summarize_session("   ")


def test_summarize_empty_model_output_raises(monkeypatch):
    _patch_client(monkeypatch, text="   ")
    with pytest.raises(ai.AIError):
        ai.summarize_session("some notes")


def test_summarize_wraps_sdk_errors(monkeypatch):
    _patch_client(monkeypatch, error=RuntimeError("boom"))
    with pytest.raises(ai.AIError):
        ai.summarize_session("some notes")


def test_summarize_without_api_key_raises_not_configured(monkeypatch):
    # No key configured (conftest doesn't set one) → the real _client() should refuse.
    ai._client.cache_clear()
    monkeypatch.setattr(ai.get_settings(), "gemini_api_key", "", raising=False)
    with pytest.raises(ai.AINotConfiguredError):
        ai.summarize_session("some notes")
    ai._client.cache_clear()
