from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import Db, get_current_user, get_or_404
from app.models.campaign import Campaign
from app.models.session import Session
from app.schemas.session import SessionCreate, SessionRead, SessionUpdate

router = APIRouter(tags=["sessions"], dependencies=[Depends(get_current_user)])


@router.get("/campaigns/{campaign_id}/sessions", response_model=list[SessionRead])
def list_sessions(campaign_id: int, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    return db.scalars(
        select(Session)
        .where(Session.campaign_id == campaign_id)
        .order_by(Session.order_index, Session.created_at)
    ).all()


@router.post(
    "/campaigns/{campaign_id}/sessions",
    response_model=SessionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_session(campaign_id: int, payload: SessionCreate, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    session = Session(campaign_id=campaign_id, **payload.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=SessionRead)
def get_session(session_id: int, db: Db):
    return get_or_404(db, Session, session_id, "Session")


@router.put("/sessions/{session_id}", response_model=SessionRead)
def update_session(session_id: int, payload: SessionUpdate, db: Db):
    session = get_or_404(db, Session, session_id, "Session")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, key, value)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: Db):
    db.delete(get_or_404(db, Session, session_id, "Session"))
    db.commit()
