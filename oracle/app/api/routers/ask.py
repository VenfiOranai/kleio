from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import Db, get_current_user, get_or_404
from app.models.campaign import Campaign
from app.schemas.rag import AskRequest as AskRequestSchema
from app.schemas.rag import AskResponse, Citation
from app.services import ai
from app.services import rag as rag_service

router = APIRouter(tags=["ai"], dependencies=[Depends(get_current_user)])


@router.post("/campaigns/{campaign_id}/ask", response_model=AskResponse)
def ask_campaign(campaign_id: int, payload: AskRequestSchema, db: Db):
    """Answer a question about a campaign from its session notes (RAG), with citations.

    Indexes any not-yet-embedded notes on demand, retrieves the most relevant chunks, and
    asks Gemini to answer using only those excerpts."""
    get_or_404(db, Campaign, campaign_id, "Campaign")
    question = payload.question.strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a question."
        )

    try:
        result = rag_service.answer_campaign_question(db, campaign_id, question)
    except ai.AINotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except ai.AIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return AskResponse(
        question=question,
        answer=result.answer,
        citations=[Citation(**vars(c)) for c in result.citations],
    )
