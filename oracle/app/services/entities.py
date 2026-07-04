"""Entity mentions: parsing ``@[Name]`` tokens and keeping the ``entities`` table in sync.

``extract_mentions`` is pure (regex, no DB/IO) and exhaustively unit-tested. The DB helpers
resolve entities **by name** (the stable key), case-insensitively per campaign."""

import re
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.models.entity import Entity
from app.models.session import Session

# @[ + name (no brackets or newlines) + ]. Names may contain spaces.
_MENTION_RE = re.compile(r"@\[([^\[\]\n]+)\]")


class InvalidEntityName(ValueError):
    """Raised when an entity name is empty or contains the reserved ``[`` / ``]`` characters."""


def extract_mentions(text: str) -> set[str]:
    """Return the distinct entity names mentioned as ``@[Name]`` in ``text``.

    Names are stripped of surrounding whitespace; blank ones are ignored. A bare ``@word``
    without brackets is not a mention. Case is preserved (dedup is left to the caller)."""
    if not text:
        return set()
    return {name.strip() for name in _MENTION_RE.findall(text) if name.strip()}


def mark_entities(text: str, names: Iterable[str]) -> str:
    """Wrap the first standalone occurrence of each known entity name in an ``@[…]`` token.

    Used to auto-tag entities in an AI-generated summary (which drops the notes' own tokens).
    Pure — no DB/IO. Rules:
    - **whole-word, case-insensitive** matches; the matched casing is preserved;
    - **longer names win** over shorter overlapping ones ("The Balrog" before "Balrog");
    - only the **first** occurrence of each name is wrapped (keeps the summary readable);
    - text already inside an ``@[…]`` token or a Markdown link is left untouched (no
      double-wrapping)."""
    cleaned = sorted({n.strip() for n in names if n and n.strip()}, key=len, reverse=True)
    if not text or not cleaned:
        return text

    alternation = "|".join(re.escape(name) for name in cleaned)
    # First alt consumes an existing @[…] token (left as-is); second matches a bare, whole-word
    # name not already inside a token or a [markdown link].
    pattern = re.compile(
        rf"@\[[^\[\]\n]+\]|(?<![\w\[])({alternation})(?![\w\]])",
        re.IGNORECASE,
    )
    seen: set[str] = set()

    def _wrap(match: re.Match[str]) -> str:
        name = match.group(1)
        if name is None:  # an existing @[Inner] token — record it so we don't re-tag Inner later
            seen.add(match.group(0)[2:-1].strip().lower())
            return match.group(0)
        if name.lower() in seen:
            return name
        seen.add(name.lower())
        return f"@[{name}]"

    return pattern.sub(_wrap, text)


def validate_name(name: str) -> str:
    """Return the trimmed name, or raise ``InvalidEntityName`` if empty or bracket-bearing."""
    name = (name or "").strip()
    if not name:
        raise InvalidEntityName("Entity name cannot be empty.")
    if "[" in name or "]" in name:
        raise InvalidEntityName("Entity name cannot contain '[' or ']'.")
    return name


def find_by_name(db: DbSession, campaign_id: int, name: str) -> Entity | None:
    """Look up an entity in a campaign by name, case-insensitively."""
    return db.scalars(
        select(Entity).where(
            Entity.campaign_id == campaign_id,
            func.lower(Entity.name) == name.strip().lower(),
        )
    ).first()


def get_or_create(
    db: DbSession,
    campaign_id: int,
    name: str,
    *,
    group_id: int | None = None,
    description: str | None = None,
) -> tuple[Entity, bool]:
    """Idempotently create an entity. Returns ``(entity, created)``; an existing
    (case-insensitive) name returns the existing row untouched."""
    name = validate_name(name)
    existing = find_by_name(db, campaign_id, name)
    if existing is not None:
        return existing, False
    entity = Entity(
        campaign_id=campaign_id, name=name, group_id=group_id, description=description
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return entity, True


def reconcile_mentions(db: DbSession, session: Session) -> None:
    """Insert any ``@[Name]`` from the session's notes that aren't entities yet (insert-only).

    Never deletes — removing a mention must not delete a curated, grouped entity. Commits only
    if something was inserted."""
    names = extract_mentions(session.raw_notes)
    if not names:
        return

    lowered = {name.lower() for name in names}
    existing = db.scalars(
        select(func.lower(Entity.name)).where(
            Entity.campaign_id == session.campaign_id,
            func.lower(Entity.name).in_(lowered),
        )
    ).all()
    existing_lower = set(existing)

    created = False
    seen: set[str] = set()
    for name in names:
        key = name.lower()
        if key in existing_lower or key in seen:
            continue
        seen.add(key)
        db.add(Entity(campaign_id=session.campaign_id, name=name))
        created = True
    if created:
        db.commit()
