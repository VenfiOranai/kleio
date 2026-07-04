"""Gemini-backed helpers: summarizing session notes, plus embeddings and RAG answering
for the Q&A-over-notes feature.

The client is created lazily (and cached) so importing this module never requires a
configured API key — only actually calling the model does. Failures are surfaced as
``AIError`` (or the more specific ``AINotConfiguredError``) for the API layer to map to
an HTTP status."""

from functools import lru_cache

from google import genai
from google.genai import types

from app.core.config import get_settings

# Embedding output width. Fixed in code because the pgvector column is this wide (see
# app.models.note_embedding.EMBED_DIM and the migration). gemini-embedding-001 supports
# Matryoshka truncation via output_dimensionality; cosine distance is scale-invariant so we
# don't renormalize the truncated vectors.
EMBED_DIM = 768

_SUMMARY_SYSTEM_INSTRUCTION = (
    "You are an assistant that writes concise, well-structured Markdown summaries of "
    "Dungeons & Dragons play-session notes. Summarize the notes the user provides, "
    "preserving key events, NPCs, player decisions, loot, and unresolved threads. Use "
    "short Markdown headings and bullet points. Respond with only the Markdown summary — "
    "no preamble, no code fences."
)

_QA_SYSTEM_INSTRUCTION = (
    "You are a helpful loremaster answering questions about a Dungeons & Dragons campaign "
    "using only the provided excerpts from the player's session notes. Each excerpt is "
    "labelled with its source like [Session 3: The Sunken Keep]. Answer the question from "
    "these excerpts only; do not invent facts. When you use information from an excerpt, "
    "cite it inline with its bracketed label. If the excerpts don't contain the answer, say "
    "so plainly. Respond in concise Markdown."
)


class AIError(RuntimeError):
    """Base class for summarization failures (model errors, empty output, etc.)."""


class AINotConfiguredError(AIError):
    """Raised when no Gemini API key is configured."""


@lru_cache
def _client() -> genai.Client:
    api_key = get_settings().gemini_api_key
    if not api_key:
        raise AINotConfiguredError("Gemini is not configured (set GEMINI_API_KEY).")
    return genai.Client(api_key=api_key)


def summarize_session(raw_notes: str) -> str:
    """Return a Markdown summary of ``raw_notes``. Never mutates the input.

    Raises ``AINotConfiguredError`` if no API key is set, or ``AIError`` for empty input,
    a failed request, or an empty model response."""
    notes = (raw_notes or "").strip()
    if not notes:
        raise AIError("There are no notes to summarize.")

    client = _client()
    try:
        response = client.models.generate_content(
            model=get_settings().gemini_model,
            contents=notes,
            config=types.GenerateContentConfig(
                system_instruction=_SUMMARY_SYSTEM_INSTRUCTION,
            ),
        )
    except Exception as exc:  # SDK/network/quota errors
        raise AIError(f"Gemini request failed: {exc}") from exc

    summary = (getattr(response, "text", None) or "").strip()
    if not summary:
        raise AIError("Gemini returned an empty summary.")
    return summary


def embed_texts(texts: list[str], *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Embed each string into a ``EMBED_DIM``-length vector, preserving order.

    ``task_type`` should be ``RETRIEVAL_DOCUMENT`` when embedding notes for storage and
    ``RETRIEVAL_QUERY`` when embedding a user's question. Raises ``AINotConfiguredError`` if
    no key is set, or ``AIError`` on a failed request or a malformed response."""
    if not texts:
        return []

    client = _client()
    try:
        response = client.models.embed_content(
            model=get_settings().gemini_embed_model,
            contents=texts,
            config=types.EmbedContentConfig(
                task_type=task_type, output_dimensionality=EMBED_DIM
            ),
        )
    except Exception as exc:  # SDK/network/quota errors
        raise AIError(f"Gemini embedding request failed: {exc}") from exc

    embeddings = getattr(response, "embeddings", None) or []
    if len(embeddings) != len(texts):
        raise AIError("Gemini returned an unexpected number of embeddings.")
    return [list(item.values) for item in embeddings]


def embed_query(text: str) -> list[float]:
    """Embed a single search query and return its vector."""
    return embed_texts([text], task_type="RETRIEVAL_QUERY")[0]


def answer_question(question: str, contexts: list[str]) -> str:
    """Answer ``question`` grounded in ``contexts`` (labelled note excerpts), returning
    Markdown. Raises ``AIError`` for empty input, a failed request, or an empty response."""
    question = (question or "").strip()
    if not question:
        raise AIError("The question is empty.")
    if not contexts:
        raise AIError("There are no note excerpts to answer from.")

    prompt = (
        "Notes excerpts:\n\n"
        + "\n\n".join(contexts)
        + f"\n\nQuestion: {question}"
    )
    client = _client()
    try:
        response = client.models.generate_content(
            model=get_settings().gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=_QA_SYSTEM_INSTRUCTION),
        )
    except Exception as exc:  # SDK/network/quota errors
        raise AIError(f"Gemini request failed: {exc}") from exc

    answer = (getattr(response, "text", None) or "").strip()
    if not answer:
        raise AIError("Gemini returned an empty answer.")
    return answer
