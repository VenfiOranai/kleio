from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import Db, get_current_user, get_or_404
from app.models.entity import Entity
from app.models.session import Session
from app.schemas.session import SessionRead
from app.services import ai, entities

router = APIRouter(tags=["ai"], dependencies=[Depends(get_current_user)])


@router.post("/sessions/{session_id}/summarize", response_model=SessionRead)
def summarize_session(session_id: int, db: Db):
    """Generate a Markdown summary of the session's notes and store it.

    ``raw_notes`` is never touched; only the editable ``summary`` field is updated."""
    session = get_or_404(db, Session, session_id, "Session")
    if not session.raw_notes.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session has no notes to summarize.",
        )

    try:
        summary = ai.summarize_session(session.raw_notes)
    except ai.AINotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except ai.AIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    # The model drops the notes' @[Name] tokens; re-tag known entities so the summary's
    # mentions render and link like the notes'. Only wraps existing entities (never creates new).
    names = db.scalars(
        select(Entity.name).where(Entity.campaign_id == session.campaign_id)
    ).all()
    session.summary = entities.mark_entities(summary, names)

    db.commit()
    db.refresh(session)
    return session
