from fastapi import APIRouter, Depends
from fastapi import Query as QueryParam

from app.api.deps import Db, get_current_user
from app.schemas.search import SearchResponse, SearchResult
from app.services import search as search_service

router = APIRouter(tags=["search"], dependencies=[Depends(get_current_user)])


@router.get("/search", response_model=SearchResponse)
def search(
    db: Db,
    q: str = QueryParam("", description="Search text (empty returns no results)"),
    campaign_id: int | None = QueryParam(None, description="Optionally scope to one campaign"),
):
    session_rows, character_rows = search_service.search(db, q, campaign_id)
    results = [
        SearchResult(
            type="session",
            id=row.id,
            campaign_id=row.campaign_id,
            campaign_name=row.campaign_name,
            title=row.title,
            snippet=row.snippet,
            rank=float(row.rank),
        )
        for row in session_rows
    ]
    results += [
        SearchResult(
            type="character",
            id=row.id,
            campaign_id=row.campaign_id,
            campaign_name=row.campaign_name,
            title=row.name,
        )
        for row in character_rows
    ]
    return SearchResponse(query=q.strip(), results=results)
