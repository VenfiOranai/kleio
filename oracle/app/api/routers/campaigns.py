from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import Db, get_current_user, get_or_404
from app.models.campaign import Campaign
from app.schemas.campaign import CampaignCreate, CampaignRead, CampaignUpdate

router = APIRouter(
    prefix="/campaigns", tags=["campaigns"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[CampaignRead])
def list_campaigns(db: Db):
    return db.scalars(select(Campaign).order_by(Campaign.created_at)).all()


@router.post("", response_model=CampaignRead, status_code=status.HTTP_201_CREATED)
def create_campaign(payload: CampaignCreate, db: Db):
    campaign = Campaign(**payload.model_dump())
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.get("/{campaign_id}", response_model=CampaignRead)
def get_campaign(campaign_id: int, db: Db):
    return get_or_404(db, Campaign, campaign_id, "Campaign")


@router.put("/{campaign_id}", response_model=CampaignRead)
def update_campaign(campaign_id: int, payload: CampaignUpdate, db: Db):
    campaign = get_or_404(db, Campaign, campaign_id, "Campaign")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(campaign, key, value)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(campaign_id: int, db: Db):
    db.delete(get_or_404(db, Campaign, campaign_id, "Campaign"))
    db.commit()
