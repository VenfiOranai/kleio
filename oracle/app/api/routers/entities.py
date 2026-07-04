from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select

from app.api.deps import Db, get_current_user, get_or_404
from app.models.campaign import Campaign
from app.models.entity import Entity, EntityGroup
from app.schemas.entity import (
    EntityCreate,
    EntityGroupCreate,
    EntityGroupRead,
    EntityGroupUpdate,
    EntityRead,
    EntityUpdate,
)
from app.services import entities as entities_service

router = APIRouter(tags=["entities"], dependencies=[Depends(get_current_user)])


def _check_group_in_campaign(db: Db, campaign_id: int, group_id: int) -> None:
    group = db.get(EntityGroup, group_id)
    if group is None or group.campaign_id != campaign_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group does not belong to this campaign.",
        )


# --- Entities --------------------------------------------------------------


@router.get("/campaigns/{campaign_id}/entities", response_model=list[EntityRead])
def list_entities(campaign_id: int, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    return db.scalars(
        select(Entity)
        .where(Entity.campaign_id == campaign_id)
        .order_by(func.lower(Entity.name))
    ).all()


@router.post("/campaigns/{campaign_id}/entities", response_model=EntityRead)
def create_entity(campaign_id: int, payload: EntityCreate, db: Db, response: Response):
    """Create an entity, or return the existing one with the same (case-insensitive) name.

    Idempotent so the editor's *Create "Name"* is safe to call optimistically. Returns 201 when
    a new row was created, 200 when an existing one was returned."""
    get_or_404(db, Campaign, campaign_id, "Campaign")
    if payload.group_id is not None:
        _check_group_in_campaign(db, campaign_id, payload.group_id)
    try:
        entity, created = entities_service.get_or_create(
            db,
            campaign_id,
            payload.name,
            group_id=payload.group_id,
            description=payload.description,
        )
    except entities_service.InvalidEntityName as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return entity


@router.get("/entities/{entity_id}", response_model=EntityRead)
def get_entity(entity_id: int, db: Db):
    return get_or_404(db, Entity, entity_id, "Entity")


@router.put("/entities/{entity_id}", response_model=EntityRead)
def update_entity(entity_id: int, payload: EntityUpdate, db: Db):
    entity = get_or_404(db, Entity, entity_id, "Entity")
    data = payload.model_dump(exclude_unset=True)

    if data.get("name") is not None:
        try:
            new_name = entities_service.validate_name(data["name"])
        except entities_service.InvalidEntityName as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        clash = entities_service.find_by_name(db, entity.campaign_id, new_name)
        if clash is not None and clash.id != entity.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An entity with that name already exists.",
            )
        entity.name = new_name

    if "group_id" in data:
        if data["group_id"] is not None:
            _check_group_in_campaign(db, entity.campaign_id, data["group_id"])
        entity.group_id = data["group_id"]

    if "description" in data:
        entity.description = data["description"]

    db.commit()
    db.refresh(entity)
    return entity


@router.delete("/entities/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(entity_id: int, db: Db):
    db.delete(get_or_404(db, Entity, entity_id, "Entity"))
    db.commit()


# --- Entity groups ---------------------------------------------------------


@router.get("/campaigns/{campaign_id}/entity-groups", response_model=list[EntityGroupRead])
def list_groups(campaign_id: int, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    return db.scalars(
        select(EntityGroup)
        .where(EntityGroup.campaign_id == campaign_id)
        .order_by(EntityGroup.order_index, func.lower(EntityGroup.name))
    ).all()


def _group_name_or_400(name: str | None) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Group name cannot be empty."
        )
    return name


def _group_name_clash(db: Db, campaign_id: int, name: str, exclude_id: int | None = None) -> bool:
    clash = db.scalars(
        select(EntityGroup).where(
            EntityGroup.campaign_id == campaign_id, EntityGroup.name == name
        )
    ).first()
    return clash is not None and clash.id != exclude_id


@router.post(
    "/campaigns/{campaign_id}/entity-groups",
    response_model=EntityGroupRead,
    status_code=status.HTTP_201_CREATED,
)
def create_group(campaign_id: int, payload: EntityGroupCreate, db: Db):
    get_or_404(db, Campaign, campaign_id, "Campaign")
    name = _group_name_or_400(payload.name)
    if _group_name_clash(db, campaign_id, name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A group with that name already exists."
        )
    group = EntityGroup(campaign_id=campaign_id, name=name, order_index=payload.order_index)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put("/entity-groups/{group_id}", response_model=EntityGroupRead)
def update_group(group_id: int, payload: EntityGroupUpdate, db: Db):
    group = get_or_404(db, EntityGroup, group_id, "Entity group")
    data = payload.model_dump(exclude_unset=True)

    if data.get("name") is not None:
        name = _group_name_or_400(data["name"])
        if _group_name_clash(db, group.campaign_id, name, exclude_id=group.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A group with that name already exists.",
            )
        group.name = name

    if data.get("order_index") is not None:
        group.order_index = data["order_index"]

    db.commit()
    db.refresh(group)
    return group


@router.delete("/entity-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: int, db: Db):
    """Delete a group; its member entities become ungrouped (``group_id`` → NULL)."""
    db.delete(get_or_404(db, EntityGroup, group_id, "Entity group"))
    db.commit()
