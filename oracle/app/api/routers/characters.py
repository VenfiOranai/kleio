from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import Db, get_current_user, get_or_404
from app.models.campaign import Campaign
from app.models.character import Character
from app.schemas.character import CharacterCreate, CharacterRead, CharacterUpdate

router = APIRouter(tags=["characters"], dependencies=[Depends(get_current_user)])


@router.get("/campaigns/{campaign_id}/characters", response_model=list[CharacterRead])
def list_characters(campaign_id: int, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    return db.scalars(
        select(Character).where(Character.campaign_id == campaign_id).order_by(Character.name)
    ).all()


@router.post(
    "/campaigns/{campaign_id}/characters",
    response_model=CharacterRead,
    status_code=status.HTTP_201_CREATED,
)
def create_character(campaign_id: int, payload: CharacterCreate, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    character = Character(campaign_id=campaign_id, **payload.model_dump())
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.get("/characters/{character_id}", response_model=CharacterRead)
def get_character(character_id: int, db: Db):
    return get_or_404(db, Character, character_id, "Character")


@router.put("/characters/{character_id}", response_model=CharacterRead)
def update_character(character_id: int, payload: CharacterUpdate, db: Db):
    character = get_or_404(db, Character, character_id, "Character")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(character, key, value)
    db.commit()
    db.refresh(character)
    return character


@router.delete("/characters/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_character(character_id: int, db: Db):
    db.delete(get_or_404(db, Character, character_id, "Character"))
    db.commit()
