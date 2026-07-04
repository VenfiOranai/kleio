"""Unit tests for the Gemini summarization wrapper. The genai client is mocked, so
these never make a network call."""

import pytest

from app.services import ai


class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _FakeEmbedding:
    def __init__(self, values):
        self.values = values


class _FakeEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings


class _FakeModels:
    def __init__(self, text=None, error=None, embed_error=None):
        self._text = text
        self._error = error
        self._embed_error = embed_error
        self.calls = []
        self.embed_calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._error is not None:
            raise self._error
        return _FakeResponse(self._text)

    def embed_content(self, *, model, contents, config):
        self.embed_calls.append({"model": model, "contents": contents, "config": config})
        if self._embed_error is not None:
            raise self._embed_error
        # One deterministic vector per input; encodes its length so tests can tell them apart.
        return _FakeEmbedResponse([_FakeEmbedding([float(len(c))]) for c in contents])


class _FakeClient:
    def __init__(self, text=None, error=None, embed_error=None):
        self.models = _FakeModels(text=text, error=error, embed_error=embed_error)


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


# --- embeddings --------------------------------------------------------------


def test_embed_texts_returns_one_vector_per_input(monkeypatch):
    client = _patch_client(monkeypatch)
    vectors = ai.embed_texts(["dragon", "tavern brawl"])
    assert vectors == [[6.0], [12.0]]  # deterministic fake: vector encodes input length
    # Documents are embedded with the retrieval-document task type.
    assert client.models.embed_calls[0]["config"].task_type == "RETRIEVAL_DOCUMENT"


def test_embed_texts_empty_list_shortcircuits(monkeypatch):
    client = _patch_client(monkeypatch)
    assert ai.embed_texts([]) == []
    assert client.models.embed_calls == []  # no API call for nothing to embed


def test_embed_query_uses_query_task_type(monkeypatch):
    client = _patch_client(monkeypatch)
    vector = ai.embed_query("who is the villain?")
    assert vector == [19.0]  # fake vector encodes the input length
    assert client.models.embed_calls[0]["config"].task_type == "RETRIEVAL_QUERY"


def test_embed_wraps_sdk_errors(monkeypatch):
    _patch_client(monkeypatch, embed_error=RuntimeError("boom"))
    with pytest.raises(ai.AIError):
        ai.embed_texts(["x"])


# --- RAG answering -----------------------------------------------------------


def test_answer_question_builds_prompt_and_returns_markdown(monkeypatch):
    client = _patch_client(monkeypatch, text="  The villain is the lich. [Session 1]  ")
    result = ai.answer_question("Who is the villain?", ["[Session 1]\nA lich schemes."])
    assert result == "The villain is the lich. [Session 1]"
    prompt = client.models.calls[0]["contents"]
    assert "A lich schemes." in prompt
    assert "Who is the villain?" in prompt


def test_answer_question_without_context_raises(monkeypatch):
    _patch_client(monkeypatch, text="unused")
    with pytest.raises(ai.AIError):
        ai.answer_question("Who?", [])


def test_answer_question_empty_output_raises(monkeypatch):
    _patch_client(monkeypatch, text="   ")
    with pytest.raises(ai.AIError):
        ai.answer_question("Who?", ["[Session 1]\nstuff"])
