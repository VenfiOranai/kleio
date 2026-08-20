"""5etools reference lookup (Phase 13) — autocomplete/browse + full-record import.

Read-only and DB-free: everything comes from the in-memory index built once from the
user-supplied dataset (see ``app.services.fivetools``). With no dataset configured, ``status``
still answers (``available: false``, so herald can hide its Browse buttons) while the data
routes return 503.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.schemas.reference import (
    ReferenceFacets,
    ReferenceFetchStatus,
    ReferenceRecord,
    ReferenceSearchResponse,
    ReferenceStatus,
    ReferenceSummary,
    ReferenceType,
)
from app.services import fivetools

router = APIRouter(
    prefix="/reference", tags=["reference"], dependencies=[Depends(get_current_user)]
)


def _index() -> fivetools.ReferenceIndex:
    try:
        return fivetools.get_index()
    except fivetools.ReferenceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


Index = Annotated[fivetools.ReferenceIndex, Depends(_index)]


@router.get("/status", response_model=ReferenceStatus)
def reference_status():
    """Always 200 — reference import is optional, so "unavailable" is an answer, not an error."""
    configured = fivetools.configured_data_dir()
    try:
        index = fivetools.get_index()
    except fivetools.ReferenceUnavailable:
        return ReferenceStatus(available=False, configured_dir=configured)
    return ReferenceStatus(available=True, counts=index.counts(), configured_dir=configured)


# --- Optional one-shot dataset download --------------------------------------


@router.get("/fetch", response_model=ReferenceFetchStatus)
def fetch_status():
    """Progress of the download job (``idle`` until one has been started this process)."""
    return ReferenceFetchStatus(**fivetools.job.status.as_dict())


@router.post("/fetch", response_model=ReferenceFetchStatus, status_code=status.HTTP_202_ACCEPTED)
def start_fetch():
    """Download a 5etools dataset into the local download dir, in the background.

    Refused (409) while one is already running, or when ``FIVETOOLS_DATA_DIR`` points at your
    own copy — downloading then would write files the index would never read.
    """
    configured = fivetools.configured_data_dir()
    if configured:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"FIVETOOLS_DATA_DIR is set ({configured}), so Kleio reads your own copy. "
                "Unset it to download a dataset instead."
            ),
        )
    started = fivetools.job.start(
        fivetools.download_dir(),
        get_settings().fivetools_source_url,
        # A finished download replaces what the (load-once) index holds.
        on_success=fivetools.reset_cache,
    )
    if not started:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A download is already running."
        )
    return ReferenceFetchStatus(**fivetools.job.status.as_dict())


@router.get("/facets", response_model=ReferenceFacets)
def reference_facets(index: Index, type: ReferenceType):
    """The filter values the loaded dataset actually contains, for the browser's controls."""
    return ReferenceFacets(type=type, **fivetools.facets(index, type))


@router.get("/search", response_model=ReferenceSearchResponse)
def search_reference(
    index: Index,
    type: ReferenceType,
    q: str = "",
    sort: str = "",
    direction: str = "asc",
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    level: Annotated[list[int], Query()] = [],  # noqa: B006 — FastAPI reads the default as a schema
    school: str = "",
    class_name: Annotated[str, Query(alias="class")] = "",
    ritual: bool | None = None,
    concentration: bool | None = None,
    category: str = "",
    rarity: str = "",
    attunement: bool | None = None,
    weapons_only: bool = False,
    kind: str = "",
):
    """Browse/autocomplete the index. Unknown sorts fall back to relevance (then name)."""
    valid_sorts = fivetools.SORT_FIELDS[type]
    if sort and sort not in valid_sorts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported sort '{sort}' for {type}; use one of: {', '.join(valid_sorts)}.",
        )
    query = fivetools.SearchQuery(
        type=type,
        q=q,
        sort=sort,
        direction="desc" if direction == "desc" else "asc",
        limit=limit,
        offset=offset,
        level=level,
        school=school,
        class_name=class_name,
        ritual=ritual,
        concentration=concentration,
        category=category,
        rarity=rarity,
        attunement=attunement,
        weapons_only=weapons_only,
        kind=kind,
    )
    total, matches = fivetools.search(index, query)
    return ReferenceSearchResponse(total=total, results=[_summary(e) for e in matches])


@router.get("/{type}/{record_id}", response_model=ReferenceRecord)
def get_reference_record(index: Index, type: ReferenceType, record_id: str):
    """One full record, normalized into the sheet's own schemas and ready to import."""
    entry = fivetools.get_entry(index, record_id)
    if entry is None or entry.type != type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Reference record not found"
        )
    return ReferenceRecord(**fivetools.normalized_record(index, entry))


def _summary(entry: fivetools.ReferenceEntry) -> ReferenceSummary:
    return ReferenceSummary(
        id=entry.id,
        type=entry.type,
        name=entry.name,
        source=entry.source,
        subtitle=entry.subtitle,
        level=entry.level,
        school=entry.school,
        classes=list(entry.classes),
        ritual=entry.ritual,
        concentration=entry.concentration,
        category=entry.category,
        rarity=entry.rarity,
        value=entry.value,
        weight=entry.weight,
        attunement=entry.attunement,
        weapon=entry.weapon,
        kind=entry.kind,
    )
