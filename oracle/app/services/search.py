"""Postgres full-text search over sessions, plus character-name matching.

Pure query builder: takes a DB session and returns result rows. Sessions are matched
against the weighted ``search_vector`` (title > summary > raw_notes) via
``websearch_to_tsquery`` and ranked with ``ts_rank``; characters are matched on name
with a case-insensitive substring (names are short, so FTS would be overkill)."""

from sqlalchemy import Row, func, select
from sqlalchemy.orm import Session as DbSession

from app.models.campaign import Campaign
from app.models.character import Character
from app.models.session import Session

# ts_headline options: wrap matches in <mark>…</mark> and keep snippets short.
_HEADLINE_OPTS = "StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=25,MinWords=8"


def _escape_like(term: str) -> str:
    """Escape LIKE/ILIKE wildcards so user input is matched literally."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_sessions(
    db: DbSession, query: str, campaign_id: int | None, limit: int
) -> list[Row]:
    tsquery = func.websearch_to_tsquery("english", query)
    rank = func.ts_rank(Session.search_vector, tsquery).label("rank")
    # Highlight over title + body (summary if present, else raw notes) so a title-only
    # match still produces a useful, highlighted snippet.
    body = func.coalesce(func.nullif(Session.summary, ""), Session.raw_notes)
    snippet = func.ts_headline(
        "english", func.concat_ws(" — ", Session.title, body), tsquery, _HEADLINE_OPTS
    ).label("snippet")

    stmt = (
        select(
            Session.id,
            Session.campaign_id,
            Session.title,
            Campaign.name.label("campaign_name"),
            rank,
            snippet,
        )
        .join(Campaign, Campaign.id == Session.campaign_id)
        .where(Session.search_vector.op("@@")(tsquery))
    )
    if campaign_id is not None:
        stmt = stmt.where(Session.campaign_id == campaign_id)
    stmt = stmt.order_by(rank.desc(), Session.created_at.desc()).limit(limit)
    return list(db.execute(stmt).all())


def search_characters(
    db: DbSession, query: str, campaign_id: int | None, limit: int
) -> list[Row]:
    pattern = f"%{_escape_like(query)}%"
    stmt = (
        select(
            Character.id,
            Character.campaign_id,
            Character.name,
            Campaign.name.label("campaign_name"),
        )
        .join(Campaign, Campaign.id == Character.campaign_id)
        .where(Character.name.ilike(pattern, escape="\\"))
    )
    if campaign_id is not None:
        stmt = stmt.where(Character.campaign_id == campaign_id)
    stmt = stmt.order_by(Character.name).limit(limit)
    return list(db.execute(stmt).all())


def search(
    db: DbSession, query: str, campaign_id: int | None = None, limit: int = 20
) -> tuple[list[Row], list[Row]]:
    """Return (session_rows, character_rows). A blank query yields no results."""
    query = (query or "").strip()
    if not query:
        return [], []
    return (
        search_sessions(db, query, campaign_id, limit),
        search_characters(db, query, campaign_id, limit),
    )
