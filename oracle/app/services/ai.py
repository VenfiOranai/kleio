"""Gemini-backed helpers. Currently: summarizing session notes into Markdown.

The client is created lazily (and cached) so importing this module never requires a
configured API key — only actually calling the model does. Failures are surfaced as
``AIError`` (or the more specific ``AINotConfiguredError``) for the API layer to map to
an HTTP status."""

from functools import lru_cache

from google import genai
from google.genai import types

from app.core.config import get_settings

_SUMMARY_SYSTEM_INSTRUCTION = (
    "You are an assistant that writes concise, well-structured Markdown summaries of "
    "Dungeons & Dragons play-session notes. Summarize the notes the user provides, "
    "preserving key events, NPCs, player decisions, loot, and unresolved threads. Use "
    "short Markdown headings and bullet points. Respond with only the Markdown summary — "
    "no preamble, no code fences."
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
