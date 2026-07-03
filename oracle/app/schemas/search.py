from typing import Literal

from pydantic import BaseModel


class SearchResult(BaseModel):
    """One hit in the unified search results.

    ``type`` discriminates sessions (full-text matched, with a highlighted ``snippet``)
    from characters (name matched). ``title`` is the session title or character name;
    ``rank`` is the FTS relevance (0 for characters, which aren't ranked)."""

    type: Literal["session", "character"]
    id: int
    campaign_id: int
    campaign_name: str
    title: str
    snippet: str | None = None
    rank: float = 0.0


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
